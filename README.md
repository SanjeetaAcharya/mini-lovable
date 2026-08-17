# mini-lovable

An AI app builder with usage-based billing. You buy a token balance, describe a site, an LLM generates it, the tokens that generation actually consumed are deducted from your balance, and deploying it publishes to a real URL for a further fee. Every balance change is an entry in an append-only ledger.

**Live app:** https://mini-lovable-web.vercel.app
**API:** https://mini-lovable-api.onrender.com

Stripe runs in test mode. Pay with `4242 4242 4242 4242`, any future expiry, any CVC.

---

## What it does

1. Buy a token pack via Stripe Checkout. Tokens are credited only after Stripe confirms the payment server-side via webhook.
2. Describe a site in a prompt. The request is rejected before the LLM is called if the balance is too low.
3. An LLM generates a small static site. The token usage OpenRouter reports for that specific call is converted to a cost and debited.
4. The result renders in a sandboxed iframe.
5. Deploying pushes it to Vercel programmatically and debits a flat fee.
6. Every purchase produces an invoice; every generation and deploy produces a ledger line with a running balance.

---

## Architecture

```
React (Vercel)
   │  fetch
   ▼
Express API (Render)
   │
   ├─ LlmService          OpenRouter call, structured-output validation
   ├─ LedgerService       the only writer of balance changes
   ├─ BillingService      usage → internal tokens, balance gates
   ├─ StripeService       checkout sessions, webhook verification
   ├─ SandboxService      Docker validation of generated files (opt-in)
   ├─ DeploymentService   Vercel Deployments API
   └─ InvoiceService      hosted HTML invoices
   │
   ▼
Prisma → PostgreSQL (Neon)
```

Routes validate input and delegate to services. Services hold the business logic and may call each other: generation calls the LLM service, then billing, then the ledger. The read-only routes, history and ledger, query Prisma directly rather than through a service that would only forward the call. Nothing bypasses `LedgerService` to change a balance.

I did not add a repository layer over Prisma. Prisma already provides a typed query interface; wrapping it would have been indirection with no benefit at this size.

---

## The ledger

There is no balance column anywhere. A user's balance is the sum of their `LedgerEntry` rows, and every entry records what caused it: a purchase, a generation, or a deployment.

```
Token purchase · Plus      +12,000     38,876
Token purchase · Starter    +5,000     43,876
Token purchase · Starter    +5,000     48,876
Generation usage               -16     48,860
Deploy fee                     -20     48,840
```

`appendEntry()` is the single write path. It runs inside a transaction: read the latest running balance, check the result won't go negative, insert. Because that read-check-write is atomic, two concurrent requests can't both spend the same tokens. The second sees the first's write before computing its own balance.

`runningBalance` is a denormalised snapshot so reading the balance is one query. It isn't the source of truth. `reconstructBalance()` sums every entry from scratch, and the two must always agree. Rather than leave that as an assertion, `GET /api/ledger` computes both on every request and returns them:

```json
"reconciliation": { "balance": 58698, "reconstructed": 58698, "agrees": true }
```

The frontend loads that endpoint on every page load, so the invariant is exercised continuously. A divergence would surface as `agrees: false` and a server-side error log rather than going unnoticed.

---

## Pricing

Internal tokens are pegged to the Starter pack: 5,000 tokens for $5, so 1,000 internal tokens per USD. Larger packs are a volume discount on purchase; consumption is always priced at this base rate.

```
charged_tokens = max(1, ceil(cost_usd × 1000 × 1.5))
```

After each generation I read OpenRouter's reported usage, convert to dollars, apply a 1.5× markup, and debit the result. The floor of 1 means a generation is never free, however trivial.

The configured model is free, so OpenRouter reports a cost of `$0`. A naive implementation would charge nothing and the metering would be untestable, so there's a documented synthetic rate of `$0.01 per 1,000 LLM tokens`, used only when the reported cost is zero or absent. A real reported cost always takes precedence. Switching to a paid model changes nothing in the code; it just starts using the real figure.

Deploys cost a flat 20 tokens, deliberately not usage-metered, because a deploy is a fixed unit of work, unlike a generation.

Generation is gated on a minimum balance of 130 tokens, derived rather than guessed: a 2,000-character prompt plus the system prompt plus the 6,000-token completion cap is about 6,850 LLM tokens worst case, which prices out at roughly 103 internal tokens. The cap on completion tokens exists specifically so this ceiling is provable, and the gate moves whenever the cap does.

---

## Security

**Payments are never client-confirmed.** The browser can't tell the server a payment succeeded. Stripe calls the API directly with a signed webhook, and only that path credits the ledger.

**Webhook crediting is idempotent by construction.** Stripe retries webhooks as a matter of course. A `Purchase` row is created with the Stripe session id (unique) before the redirect. The webhook then flips `PENDING → PAID` with a conditional update and checks how many rows changed, which is a compare-and-swap in a single statement. A duplicate delivery matches zero rows and stops. `LedgerEntry.purchaseId` is also unique, so the database rejects a second credit even if that guard failed.

**Balance checks happen server-side, before the expensive call.** Insufficient balance returns 402 without touching OpenRouter. The frontend hiding a button is not a check.

**Generated code is treated as untrusted input.** File paths from the model are validated against a whitelist pattern that rejects traversal and absolute paths, before anything is written to disk. The preview iframe uses `sandbox="allow-scripts"` without `allow-same-origin`, so generated JavaScript can run but can't reach this app's cookies, storage, or API.

**Prompt guardrails.** Prompts are length-capped and rejected if they're clearly not website requests, including obvious prompt-injection attempts.

**Secrets** are environment variables, never sent to the client. `.env` is gitignored and `.env.example` documents every required variable.

---

## Sandboxing: what I did and didn't do

The spec prefers E2B or Blaxel and permits an isolated Docker build step as a fallback. I chose Docker: the hosted sandbox free tiers were an availability risk against a fixed time budget, and Docker kept the whole path under my control.

`SandboxService` writes the validated file map to a throwaway directory and runs one disposable container against it, with `--network none`, `--read-only`, memory/CPU/pid limits, `--cap-drop ALL`, `no-new-privileges`, a non-root user, a 15-second hard timeout that kills the container, and forced removal in a `finally` block regardless of outcome. `POST /api/deploy/:id` calls it before pushing anything to Vercel; a rejection returns 422 and no deployment is created.

**The container never executes the generated code.** It reads the files to check extension, size, and encoding, and structurally parses `index.html` with Python's stdlib parser. There is no execution to escape from, which is a stronger position than running untrusted code under isolation.

**It is off by default, and off in production.** Validation is gated behind `SANDBOX_ENABLED`, which must be exactly `true` to switch on. The reason is infrastructural rather than philosophical: it needs a Docker daemon, and Render runs this API *inside* a container without one. Enabled there, every deploy would fail on the absence of a daemon rather than on anything about the generated site. So on the live deployment the step is skipped and logged as skipped. It runs where a daemon exists: local development, or a host that grants one.

That is the honest state of it. The validation is wired into the deploy path and gated, not wired in and silently dead, but the live URL you're reviewing is not exercising it.

**Honest limitation:** this is a shared-kernel container, not a microVM. A kernel exploit or container-runtime escape isn't stopped the way E2B's hardware virtualisation would stop it. That gap matters less here because nothing is executed, but it is a real gap.

**Second honest limitation:** I chose not to spend the disk space and time installing Docker Desktop with the frontend and deployment still unbuilt, so the container orchestration path is written and typechecked but not exercised against a real daemon. The validation logic itself is tested directly, and the service degrades cleanly when Docker is absent, returning a structured failure rather than throwing. With more time or a different machine, proving that path is the first thing I'd do.

---

## Handling bad LLM output

The model is not trusted to follow instructions. The system prompt specifies the exact JSON shape, forbids prose, fences, frameworks, and CDN links, and imposes a hard size budget (at most 3 files, 2,500 characters per file, 6,000 characters total, no inline data URIs); the request sets `response_format: json_object`; and the response is still parsed defensively: strip fences if they appear, narrow to the outermost braces, parse, then validate the structure, the file count, each path, each size, and the presence of `index.html`.

The size budget is load-bearing rather than cosmetic. Without it the file-count limit was the only bound, and the model satisfied it by writing five enormous files — 23,000 to 28,000 characters — that ran past any completion cap and came back as unterminated JSON. Raising the cap from 2,000 to 8,000 did not help; the model expanded to fill it and truncated at the new ceiling instead. Constraining output length is what fixed it, and the cap is now a backstop above the observed maximum rather than the thing doing the work.

`generateSite()` returns a discriminated union rather than throwing: `success`, `invalid_output` (the model responded, unusably), or `error` (the request never completed). That distinction drives billing.

**On `invalid_output`, the user isn't charged.** OpenRouter bills me for those tokens regardless, so there's a real cost. But the user asked for a working site and didn't get one. Charging for a failed generation generates support cost worth more than the pennies recovered. The usage is still recorded on the `Generation` row so the failure rate is visible in the data; it just isn't debited. At scale I'd alert on that rate, because a rising one means my prompt or model choice needs work.

**This is the limitation I'm least comfortable with.** Free-tier models return JSON they can't keep well-formed. This originally read as a truncation problem — 15 of 24 generations failing, a 63% rate — but truncation turned out to be a symptom: nothing bounded output length, so the model wrote until it hit whatever completion cap it was given. Raising the cap from 2,000 to 8,000 made it worse, not better, because the model expanded to fill the new ceiling. A size budget in the system prompt is what actually fixed that part: attempts against the heaviest prompt went from 5 of 5 truncating to 1 of 15. What remains is the model emitting bad escape sequences and unbalanced braces partway through an otherwise complete response, which no cap can fix, at a rate I could not pin down — two samples of the same prompt gave 4 of 6 and 0 of 4. It's handled correctly, with a clear message, no charge, and no crash, but a reviewer trying a few prompts may still hit it. It's a consequence of the $0 budget constraint rather than the architecture; a paid model would largely remove it.

---

## Local setup

```bash
git clone https://github.com/SanjeetaAcharya/mini-lovable
cd mini-lovable
npm install
cp .env.example apps/api/.env      # fill in your values
cd apps/api && npx prisma migrate dev && npx prisma db seed
```

The seed prints a user id. Put it in `DEMO_USER_ID`.

Then, in separate terminals:

```bash
npm run dev --workspace api        # :4000
npm run dev --workspace web        # :5173
stripe listen --forward-to localhost:4000/api/webhook
```

The Stripe CLI prints a signing secret; that goes in `STRIPE_WEBHOOK_SECRET` for local development. The deployed API uses a different secret from a webhook endpoint registered in the Stripe dashboard.

To exercise sandbox validation locally, build the image and switch the flag on:

```bash
docker build -f docker/sandbox.Dockerfile -t mini-lovable-sandbox docker/
# then set SANDBOX_ENABLED=true in apps/api/.env
```

---

## Deployment

The frontend is a static build on Vercel. The API runs on Render rather than a serverless platform, for two reasons: generations take 30+ seconds and hold a connection, and Prisma in a serverless environment reintroduces the connection-pool problems this app is specifically hardened against. Render runs the existing `app.listen()` unmodified. Railway was ruled out because its free tier is now a one-time credit rather than an ongoing allowance.

Deploying a generated site is a call to the Vercel Deployments API from `DeploymentService`, triggered by the backend, never manually.

CI runs on push and PR to `main`: install, `prisma generate`, typecheck, lint, build, across both workspaces. No database or secrets required.

---

## What I cut, and why

**Auth.** Explicitly out of scope. One seeded user, its id in an environment variable. Adding real auth would have consumed hours that went into billing correctness instead.

**PDF invoices.** The spec calls PDF ideal and hosted HTML acceptable. What's evaluated is the content (item, amount, date, reference number), not the format. A PDF pipeline meant another rendering dependency for no additional signal.

**Model fallback.** A generation now retries once against the same model on unusable output, with the billing rule that complicated it resolved: usage is tracked per attempt and only the surviving attempt is charged, so a failed attempt is absorbed rather than billed. Truncated responses are deliberately not retried, since an identical request against an identical cap truncates in the same place. Falling back to a *different* model on the second attempt is the remaining improvement, and is now a small change rather than a structural one. Worth noting the retry earned its place on the earlier failure profile; against the current one it rescued neither of the two failures it fired on, so its value is unproven at the present rate.

**Structured logging.** Currently `console.log`. Adequate for a demo, not for production. I'd thread a request id through each request so a single generation could be traced from the API call through the LLM request, ledger write, and deploy. That matters most on billing paths, where "was this user charged twice" needs an answerable audit trail beyond the ledger itself.

**Automated tests beyond the critical paths.** I verified the ledger arithmetic, webhook idempotency (including two concurrent deliveries of the same event), the insufficient-balance gate, and every LLM failure mode by direct execution rather than a test suite. Under this time budget I'd rather have proven the paths where money moves than have coverage numbers on the ones where it doesn't.

**Retry on deploy failure.** A failed Vercel deploy marks the row `FAILED` and doesn't charge. It doesn't retry. A stuck `PENDING` row from a crashed process would block redeploying that generation.

---

## Some things that only appeared in production

`CLIENT_URL` had a trailing slash, which broke CORS in a way that isn't obvious. `Access-Control-Allow-Origin` must exactly match the browser's `Origin` header, and origins never carry a trailing slash. It also broke the Stripe redirect.

Vite's dev server silently does SPA fallback for unknown paths; Vercel doesn't. So the Stripe return URL worked locally and 404'd in production until I added an explicit rewrite.

The GET helpers returned `res.json()` without checking `res.ok`, so a sleeping Render instance's 502 HTML page became `undefined` rather than an error, which is why cold starts failed silently rather than showing anything. Render's free tier spins down after 15 minutes, so the app now retries for ~90 seconds with a visible "waking up the server" state instead of an empty page.

Abandoned Stripe checkouts leave a `PENDING` purchase row permanently. The row has to exist, because the webhook finds the purchase by session id and that's what makes crediting idempotent, so deleting them would break the guarantee. `/api/history` excludes them instead.

---

## On Rust

Not used, and not needed here. Most of this app is I/O-bound glue between HTTP APIs, where Rust would add compile time and complexity for no benefit.

The one place I'd reach for it is sandbox validation. That component reads adversarial input (files an LLM produced, which I treat as untrusted) and parses HTML. Memory safety and predictable resource behaviour matter more there than anywhere else in the system, and it's the component most likely to be a security boundary in a real version of this product.

---

## Production secrets

Everything here is environment variables in platform config, with `.env` gitignored and `.env.example` as documentation. That's the right shape for a take-home and the wrong shape for production.

In production I'd use a managed secrets store such as AWS Secrets Manager, Vault, or the platform's own, with scoped access per service, audit logging on reads, and automated rotation. The webhook secret and database credentials in particular shouldn't be values a developer can read from a dashboard.

Worth being direct about one thing: early in this build I committed `.env` before the root `.gitignore` was correct. I caught it, untracked the file, and rotated every affected credential. Rotation was the right fix, since rewriting history doesn't help once values are public, but the real lesson is that `.gitignore` belongs in the first commit, before anything else exists. A secrets manager would have made the mistake impossible rather than recoverable.

---

## Known limitations

- Free-tier LLM still returns malformed JSON on a substantial share of generations. The size budget fixed truncation specifically: before it, 5 of 5 attempts against the heaviest prompt truncated at the completion cap; after it, 1 of 15. What remains is bad escape sequences and unbalanced braces mid-response, which no cap addresses. The residual success rate is unstable — two samples of the same prompt gave 4/6 and 0/4, pooling to 4 of 10 — and the daily request cap below stopped me measuring it properly. Handled cleanly, but visible.
- OpenRouter's free tier allows 50 model requests per day per account. Exhausting it returns 429, which this app surfaces as a 502 with "Generation failed", indistinguishable at a glance from a malformed-output failure until you read the logs. A reviewer testing repeatedly can hit this and conclude the app is broken when it is rate-limited. Adding 10 credits raises the cap to 1,000/day.
- Sandbox validation is wired into the deploy path but gated behind `SANDBOX_ENABLED`, and is off on the live deployment because Render provides no Docker daemon. The container path has not been exercised against a real daemon.
- Render's free tier sleeps after 15 minutes; first request after idle takes 30 to 60 seconds.
- Neon's free tier suspends on inactivity. The API retries transient connection failures and no longer crashes on them, but a cold database still adds latency.
- Single hardcoded user, no auth.
- No retry on deploy failure; a crashed deploy can leave a generation unable to be redeployed.
- `console.log` rather than structured logging.
