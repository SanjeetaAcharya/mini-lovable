# Mini-Lovable — Architecture & Implementation Plan

Planning document written before implementation. Covers my reading of the requirements, stack decisions, architecture, database design, and the phased build order.

---

## Status

Deadline: 17 August.

**Complete**

- Monorepo scaffolded with npm workspaces: `apps/web`, `apps/api`, `packages/shared`. API runs on port 4000, Vite frontend on 5173.
- Prisma schema migrated to Neon Postgres. All six tables live. Demo user seeded.
- Ledger service implemented and verified: `appendEntry()`, `getBalance()`, `reconstructBalance()`. Test run confirmed 5000 credit → 137 debit → 100 debit = 4763, with both balance methods agreeing and an over-debit correctly rejected.
- `GET /api/balance` returning live data from the ledger.
- Stripe integration (Phase 5). `POST /api/checkout` creates a Stripe Checkout Session plus a matching `PENDING` Purchase row, and returns the session URL — verified against the real Stripe test-mode API. `POST /api/webhook` verifies the Stripe signature on the raw body and credits the ledger on `checkout.session.completed`, using a conditional `status: PENDING → PAID` update as a compare-and-swap idempotency guard, with `Purchase.stripeSessionId` and `LedgerEntry.purchaseId`'s uniqueness as a DB-level backstop. Verified end to end with the Stripe CLI listener: a real hosted-Checkout payment with the `4242` test card credited the ledger exactly once, and resending the identical event via `stripe events resend` left the balance unchanged.
- OpenRouter integration (Phase 6). `services/llm.service.ts` exports `generateSite(prompt)`: calls OpenRouter with a system prompt that forces bare-JSON output (`{"files": {...}}`, `index.html` required, no prose/fences/frameworks/CDNs), then parses and validates the response into a `FileMap`. Returns a `{status: "success" | "invalid_output" | "error"}` result — never throws on a bad model response. Malformed-output handling covers: prose with no JSON, markdown-fenced JSON (recovered), missing `index.html`, path traversal in a file name, truncated JSON, network failure, and a live 400 from an invalid model ID — each returns a diagnosable reason instead of crashing. Real token usage (`prompt_tokens`, `completion_tokens`, and `cost` when OpenRouter reports it) is read off the actual response via `usage: {include: true}`, not estimated. Verified live against `OPENROUTER_MODEL` (read from env, no hardcoded model): a real prompt returned a valid two-file site (`index.html` + `styles.css`) with real usage numbers.
- Generation billing (Phase 7). `config/pricing.ts` adds the usage → cost → internal-token formula: real OpenRouter cost is preferred, falling back to a documented synthetic price (`SYNTHETIC_PRICE_PER_1K_LLM_TOKENS_USD = 0.01`, i.e. ~$10/1M tokens) whenever the model reports $0 or no cost, times a 50% markup (`MARKUP_MULTIPLIER`), pegged to the starter pack's rate (`INTERNAL_TOKENS_PER_USD = 1000`). `services/billing.service.ts` adds `assertSufficientBalance()` (a conservative pre-flight gate, `MIN_BALANCE_FOR_GENERATION = 50`, derived from the prompt-length cap + `MAX_COMPLETION_TOKENS` now enforced on the OpenRouter request) and `chargeForGeneration()` (converts usage → internal tokens, debits via `appendEntry()` linked to the generation id — `appendEntry`'s own transactional check is the real, final enforcement). `routes/generate.ts` orchestrates: validate prompt (non-empty, ≤2000 chars, off-task/prompt-injection denylist) → balance pre-flight (402 if short, before the LLM is ever called) → create `Generation` `PENDING` → `generateSite()` → on success, charge and mark `SUCCEEDED`; on `invalid_output` or `error`, mark `FAILED` with whatever real usage exists and *no* debit — the business absorbs the cost of its own failure rather than charging for it. Verified live: a real generation naturally hit `invalid_output` (the free model emitted a bad JSON escape) and recorded usage with no charge and no balance change; a second real generation `SUCCEEDED` and charged exactly 16 internal tokens, matching `usage → cost → tokens` by hand and matching the linked `LedgerEntry.amount` exactly; the insufficient-balance path was verified by temporarily raising the threshold above the real balance, confirming a 402, no `Generation` row created, and no LLM round-trip (sub-second response vs. the ~30s+ real OpenRouter latency observed elsewhere).

- Sandboxed build (Phase 8). `docker/sandbox.Dockerfile` builds a locked-down image (non-root, no shell, network-less by design) around `docker/validate.py`, which runs read-only against a bind-mounted temp dir and does exactly two things: checks every file's extension/size/UTF-8-ness against a static-content allowlist, and structurally parses `index.html` with Python's stdlib `html.parser` (tag-balance check). `services/sandbox.service.ts` stages a `FileMap` to a temp dir (with its own path-traversal guard, independent of the one already in `llm.service.ts`), runs one throwaway container per validation with `--network none`, memory/CPU/pids limits, a hard timeout, and guaranteed `docker rm -f` cleanup in a `finally` block covering success, failure, and timeout alike. Returns a structured `{valid, artifactPath | reason}` result, never throws. **The container-execution path itself is untested** — Docker Desktop isn't installed on this dev machine, and installing it now was judged not worth the disk space and time with the frontend and deployment still unbuilt. What's verified instead: `validate.py`'s logic run directly via local Python against a known-good file set (passed), one with mismatched/unclosed HTML tags (correctly rejected with specific reasons), and one with a disallowed `.php` extension (correctly rejected); and the TypeScript service's failure paths with Docker absent — confirms it degrades to a structured `invalid` result rather than throwing, and that temp dirs are cleaned up. `tsc --noEmit` passes. This is called out explicitly in the README as a known limitation rather than a claimed-but-unverified integration.

- Vercel deployment (Phase 9). `services/deployment.service.ts` pushes a generation's FileMap to Vercel's Deployments API (`POST /v13/deployments`, files inlined as base64, `target: "production"`, no framework/build settings) and polls `GET /v13/deployments/:id` until `readyState` resolves, on a hard timeout. `routes/deploy.ts` (`POST /api/deploy/:generationId`) enforces the order: load the generation and confirm it exists, belongs to the demo user, and `SUCCEEDED`; reject with 409 if a `Deployment` row already exists for it; a balance pre-flight against the fixed `DEPLOYMENT_FEE_TOKENS` (402 if short, before any Vercel call); create the `Deployment` row `PENDING`; call Vercel; on failure mark `FAILED` with no debit (same absorb-the-cost-of-our-own-failure principle as generation billing); on success, debit the fee via `appendEntry()` linked to the deployment id, and only then mark `LIVE` — if that debit ever loses a balance race, the deployment is marked `FAILED` and the Vercel deploy is treated as a sunk cost rather than handed out for free. `config/pricing.ts` adds `DEPLOYMENT_FEE_TOKENS` (flat 20, not usage-metered — Vercel doesn't report a per-deploy cost the way OpenRouter does). Verified live end to end against the real Vercel API using an actual `SUCCEEDED` generation already in the database: the deploy returned a live URL in ~7s, the ledger debited exactly 20 tokens matching the balance before/after, and hitting the URL directly served the real generated `index.html` plus its linked `styles.css`/asset files with `200`s. Also verified the guard paths: redeploying the same generation returns `409` with the existing URL, an unknown generation id returns `404`, and a generation that never succeeded returns `400`. One live surprise fixed in code, not worked around by hand: newly created Vercel projects now default to gating *all* deployments — including production — behind Vercel's own SSO wall, which would have silently made the returned URL redirect to a login page instead of the site; `deployment.service.ts` now explicitly disables that (`PATCH /v9/projects/:name` with `ssoProtection: null`) right after the project is created, best-effort, and this was confirmed against a second, independent fresh generation deployed with no manual intervention.

- Invoices, history, and ledger endpoints (Phase 10, kept deliberately minimal). `services/invoice.service.ts` renders a purchase's invoice as plain, legible HTML (item, amount, date, invoice number) — hosted HTML per the plan, not PDF. Invoice numbers are derived directly from the purchase id (`INV-<purchaseId>`) rather than a separate counter, since the id is already guaranteed unique — nothing extra to coordinate. The `Invoice` row is created inline in `stripe.service.ts`'s `creditPurchaseFromSession()`, right after the ledger credit; non-fatal on failure (the balance credit is the part that matters, and a missing invoice from the rare crash-in-between case can be backfilled later rather than risking the credited money on it). `GET /api/invoices/:id` serves it, scoped to the demo user. `GET /api/history` returns purchases (with `invoiceId`), generations, and deployments in one shape, deliberately excluding each generation's full file map (the frontend already has that from its own `/generate` call). `GET /api/ledger` returns raw ledger entries with running balance. Verified live: backfilled invoices for the three pre-existing PAID purchases (created before this feature existed), confirmed the rendered HTML, a 404 on an unknown id, and that history/ledger reflect real generation and deployment activity exactly.

- Frontend (Phase 11). Single-page React app in `apps/web`, Tailwind v4 via `@tailwindcss/vite`, no router — the one place that could have wanted one (returning from Stripe Checkout to `/purchase/success` or `/purchase/cancelled`) is instead handled by reading `window.location.pathname` once via a lazy `useState` initializer and cleaning the URL with `history.replaceState`. Layout: balance + buy-pack buttons, a prompt textarea + Generate button, a live preview, a Deploy button, and Ledger/Purchases/Generations/Deployments tables with invoice links. States handled explicitly: a generation in flight shows a "usually 30 seconds or more" notice rather than nothing; a 402 from either `/generate` or `/deploy` shows the actual balance vs. what's required and points at the buy buttons; a failed generation shows the server's real reason, not a generic error. The preview is the one place with real engineering: an iframe's `srcDoc` has no base URL to resolve a generated site's relative `<link href>`/`<script src>` against, so `lib/preview.ts` inlines every referenced CSS/JS/SVG file directly into the HTML before handing it to the iframe (a regex-based text transform, not a full parser — fine for a preview, not trusted as a security boundary). The iframe itself is sandboxed with `allow-scripts` and no `allow-same-origin`, so the generated site's JS runs but can't reach this app's cookies, storage, or same-origin API. Verified live end to end with a real headless-browser run (Playwright, since no project-level browser-driving skill existed yet): balance and buy buttons rendered with real data, a real generation completed and rendered a styled preview (background color, hours list, all correctly inlined from the model's separate `styles.css`), Deploy went live and the returned URL loaded with a 200, and the Ledger/Purchases/Generations/Deployments tables — including a working invoice link — reflected the exact actions just taken. Zero browser console errors during the run.

- CI (Phase 12, workflow only — README and walkthrough video still remain). `.github/workflows/ci.yml` runs on push and PR to `main`: checkout, Node 20 via `actions/setup-node` (with npm caching), `npm ci`, `npx prisma generate --schema=apps/api/prisma/schema.prisma`, then `npm run typecheck` / `lint` / `build` at the root, each of which fans out across both workspaces via `--workspaces --if-present` (web has no `typecheck` script — `tsc -b` is already the first half of its `build` — so that one's a no-op there, by design, not a gap). Deliberately configured to need zero secrets: `prisma generate` only reads `schema.prisma` to emit typed client code, it never opens a database connection, so `DATABASE_URL` doesn't need to exist at all — verified locally by renaming `apps/api/.env` out of the way and confirming generate/typecheck/lint/build all still pass with the variable completely unset. Prisma client generation has to run before typecheck specifically because `apps/api` imports `@prisma/client`'s generated types, which don't exist until generate has run. Pushed to `main` and confirmed green on GitHub Actions (run [31829152923](https://github.com/SanjeetaAcharya/mini-lovable/actions/runs/31829152923)): every step — checkout, setup-node, `npm ci`, prisma generate, typecheck, lint, build — succeeded on a clean runner with no repo secrets configured.

- Process resilience against a suspended database. Found the hard way: Neon's free tier suspends its compute after inactivity, and a Prisma call against a suspended instance can throw (`P1017`/`P1001`-style connection errors) — Express 4 does not catch a rejected promise from an async route handler, so an uncaught one is an unhandled rejection, and Node kills the process on those by default. That's exactly what happened (`deploy.ts:78`, a plain `prisma.deployment.update()` with no surrounding try/catch, took the whole server down; found dead again later from the same root cause elsewhere). Two-part fix, not one: (1) `middleware/asyncHandler.ts` wraps every route handler so a rejection reaches `next(err)` instead of escaping uncaught, and `middleware/errorHandler.ts` is mounted last in `index.ts` as the single place that turns any of those into a logged-server-side, generic-to-the-client 500 — plus a `process.on('unhandledRejection'/'uncaughtException')` backstop in `index.ts` for anything that could somehow escape Express's cycle entirely, explicitly documented as a net under the real fix, not a substitute for it. (2) `lib/prisma.ts` replaces the seven separate `new PrismaClient()` instances that had accumulated across routes/services with one shared client, extended via `$allOperations` to retry a transient connection error (checked by Prisma error code and by message, since a connection-level failure doesn't always carry a clean code) with linear backoff before giving up. The one interactive transaction in the codebase (`ledger.service.ts`'s `appendEntry`) is deliberately *not* left to that per-query retry — a Postgres transaction is all-or-nothing, so retrying a single statement inside an aborted one is the wrong unit of retry; instead the whole `$transaction(...)` call is wrapped in a separate `withRetry()` at the call site, safe because a transaction that didn't commit is guaranteed to have written nothing. Verified live: pointed `DATABASE_URL` at an unreachable host and restarted the server — `/health` (no DB touch) stayed healthy throughout, `/api/balance` and `POST /api/deploy/:id` (the originally-reported crash site) each logged three retry attempts and then returned a clean `{"error":"Internal server error"}` 500 with no stack trace or raw Prisma error leaked to the client, and the process kept answering `/health` after repeated consecutive failures. Restarted against the real database afterward and confirmed the balance and ledger were untouched and correct — the failure simulation caused no data corruption.

**Remaining**

README, walkthrough video.

---

## Environment notes

- Prisma is pinned to exactly `6.19.3`, no caret. Prisma 7 moves the datasource URL out of `schema.prisma` into `prisma.config.ts` and requires an explicit driver adapter. I chose the stable major version with mature documentation rather than absorbing a breaking config migration mid-build.
- Development on Windows with cmd.exe. Bash-style commands need adapting.
- Stripe CLI installed at `C:\stripe\stripe.exe`, called by full path rather than added to PATH.
- No auth layer. A single seeded user id lives in `DEMO_USER_ID` in `apps/api/.env` and is used for every request.
- Two `.env` files: one at the repo root, one in `apps/api`. Prisma reads the latter, and so does the API process itself (`dotenv/config` resolves against `process.cwd()`, which npm workspaces sets to `apps/api` for `npm run dev --workspace apps/api`) — new secrets (Stripe, OpenRouter, Vercel) need to land in `apps/api/.env`, not just the root one.
- `apps/api/tsconfig.json` originally paired `module: commonjs` with `moduleResolution: bundler`, which `tsc` rejects outright (TS5095). Fixed to `moduleResolution: node`.

---

## 1. What the assignment is testing

Mapping each required component to the signal it sends:

| Feature                                          | Why it's in the spec                                                                                         | What it demonstrates                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Token purchase via Stripe test mode              | A buy button is trivial. Webhook-confirmed crediting is not.                                                 | Understanding that the client cannot be trusted to confirm payment                |
| Usage-based deduction from real OpenRouter usage | A flat per-generation fee is easy. Reading actual usage off the response and converting it is the real work. | Ability to build metered billing, the hard part of any AI product backend         |
| Server-side balance checks                       | Hiding a button when balance is low is not a check.                                                          | Understanding of trust boundaries; whether the system survives a raw curl request |
| Ledger that reconstructs balance                 | Called out twice in the spec.                                                                                | Whether I default to mutable state or append-only accounting                      |
| Sandboxed build before deploy                    | Running LLM-generated code is a remote code execution vector.                                                | Treating generated code as untrusted input                                        |
| Programmatic deployment                          | Spec explicitly rules out manual deploys.                                                                    | Real automation rather than a demo assembled by hand                              |
| Invoice plus separate usage ledger               | Two documents serving two purposes: purchase record and operational audit trail.                             | Understanding they are not the same artifact                                      |
| CI running install, typecheck, lint, build       | Baseline, not a differentiator — but its absence is a red flag.                                              | Whether I ship with a safety net                                                  |
| Real commit history                              | Called out explicitly.                                                                                       | Whether the work was built incrementally                                          |
| README covering tradeoffs                        | Spec says this carries real weight.                                                                          | Self-assessment; knowing what was cut and why                                     |

**Out of scope per the spec:** full auth, multi-tenant billing, subscriptions, refunds, arbitrary framework support, pixel-perfect design, Rust.

**Deliberately not spending time on:** a landing page for the tool itself, a component library, retry or queue infrastructure, multi-model routing, exhaustive unit test coverage, or a PDF invoice pipeline when hosted HTML is explicitly acceptable.

---

## 2. Cost and free-tier check

Budget for this project is zero. Every external service was checked before building against it.

| Service        | Free?                                        | Limitation                                                                                | Fallback                                                                                                                                                                 |
| -------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe         | Yes — test mode, no card required            | Payments aren't real; webhooks need CLI forwarding locally                                | None needed                                                                                                                                                              |
| OpenRouter     | Yes — models with the `:free` suffix         | Free models are rate-limited and may report `$0` cost, weakening the metered-billing demo | Implement the conversion logic against a documented synthetic price per 1K tokens so the accounting is demonstrably correct even when the underlying dollar cost is zero |
| E2B / Blaxel   | Limited free tier                            | Capped sandbox minutes; cold starts and setup risk eating the time budget                 | Docker build container — explicitly allowed by the spec                                                                                                                  |
| Vercel         | Yes — Hobby tier supports API-driven deploys | Deployment rate limits; no custom domain                                                  | Cloudflare Pages                                                                                                                                                         |
| Neon Postgres  | Yes                                          | Storage cap, cold starts                                                                  | SQLite locally if needed                                                                                                                                                 |
| GitHub Actions | Yes for public repos                         | None relevant                                                                             | —                                                                                                                                                                        |

Two decisions locked before building:

**Sandbox: Docker, not E2B or Blaxel.** The spec permits an isolated Docker build step as a fallback. Free-tier limits on a hosted sandbox are a real risk against a fixed time budget, and Docker keeps the whole path under my control. I will document honestly in the README that this is weaker isolation than a purpose-built sandbox platform.

**Invoice: hosted HTML, not PDF.** The spec calls PDF ideal and hosted HTML acceptable. What's being evaluated is the content — item, amount, date, reference number — not the file format. A PDF pipeline adds a rendering dependency for no additional signal.

---

## 3. Stack

| Layer      | Choice                               | Rationale                                                                               | Rejected                                                                             |
| ---------- | ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Frontend   | React + TypeScript + Vite + Tailwind | Fast dev loop, minimal config, no hand-rolled CSS under time pressure                   | Next.js — routing and server component decisions I don't need for a single-page demo |
| Backend    | Node + TypeScript + Express          | Boring and explicit; no framework magic to defend                                       | Fastify (marginal gain), tRPC (the spec wants REST design, and it's assessed)        |
| Database   | PostgreSQL + Prisma                  | Ledger correctness needs real transactions; migrations double as visible schema history | Raw SQL (slower to write correctly), TypeORM (more ceremony, no benefit)             |
| LLM        | OpenRouter                           | Spec's stated preference; usage and cost accounting built into the response             | Direct OpenAI/Anthropic — allowed, but more custom accounting                        |
| Payments   | Stripe test mode                     | Required                                                                                | —                                                                                    |
| Sandbox    | Docker                               | See above                                                                               | E2B / Blaxel                                                                         |
| Deployment | Vercel API                           | Token-based deploys for static output, generous free tier                               | Cloudflare Pages — equivalent; not worth deliberating                                |
| Monorepo   | npm workspaces                       | Shares a few types between apps with zero extra tooling                                 | Turborepo, Nx — build-graph config I'd have to justify at this scale                 |

---

## 4. Architecture

```
Frontend (React / TypeScript)
   │  fetch, JSON
   ▼
Express REST API
   │  routes validate and delegate; no business logic
   ▼
Services
   ├─ LlmService          calls OpenRouter, parses and validates structured output
   ├─ LedgerService       append-only ledger writes, balance reconstruction
   ├─ BillingService      usage → internal token cost, balance checks
   ├─ StripeService       checkout sessions, webhook verification
   ├─ SandboxService      Docker build container, output validation
   ├─ DeploymentService   Vercel API, records live URL
   └─ InvoiceService      hosted HTML invoice on purchase
   │
   ▼
Prisma client
   ▼
PostgreSQL (Neon)
   ▼
External: OpenRouter, Stripe, Docker daemon, Vercel
```

**Routes** parse the request, validate its shape, call one service method, map the result to an HTTP response.

**Services** hold all business logic. A service may call another service — generation calls the LLM service, then the ledger — but routes never bypass services to reach the database.

**No repository layer.** Prisma already provides a typed data-access layer. Wrapping it in a repository interface would be indirection with no benefit at this scale.

**LedgerService is the only place balance changes.** There is no balance column anywhere; balance is always derived from the ledger.

---

## 5. Project structure

```
mini-lovable/
├── apps/
│   ├── web/                     React frontend
│   │   └── src/
│   │       ├── components/      PromptInput, BalanceBadge, PreviewFrame, LedgerTable
│   │       ├── api/             thin fetch wrappers per resource
│   │       └── App.tsx
│   │
│   └── api/                     Express backend
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── seed.ts
│       │   └── migrations/
│       └── src/
│           ├── routes/          one file per resource
│           ├── services/        business logic
│           ├── config/          pricing, token packs
│           └── index.ts
│
├── packages/shared/             types shared across both apps
├── docker/sandbox.Dockerfile    isolated build image
├── .github/workflows/ci.yml     install, typecheck, lint, build
├── .env.example
└── README.md
```

Two notes worth recording:

The webhook route needs the raw request body for Stripe signature verification, so it requires its own body-parsing configuration separate from the rest of the app.

`packages/shared` keeps the frontend and backend on the same API payload types instead of duplicating interfaces on both sides. It's the only piece of monorepo tooling here that earns its place.

---

## 6. Database design

The core constraint from the spec: a user's balance must be reconstructable from ledger history alone. So there is no balance column anywhere. Balance is always the sum of ledger entries.

**Tables**

`User` — id, email, timestamps.

`Purchase` — links to Stripe. `stripeSessionId` is unique, which is what makes webhook crediting idempotent at the database level. Holds amount paid, tokens purchased, and status (pending, paid, failed).

`Invoice` — one per purchase, with a unique invoice number and issue date.

`Generation` — the prompt, status, model used, prompt and completion token counts, the OpenRouter cost, the internal tokens charged, and the validated file map returned by the model.

`Deployment` — one per generation, with status, live URL, and tokens charged.

`LedgerEntry` — the source of truth. Type (credit purchase, debit generation, debit deployment), signed amount, a running balance snapshot, and a unique nullable foreign key to whichever entity caused it.

**Worked example**

```
Purchase     +5000  → running balance 5000
Generation    -137  → running balance 4863
Deployment    -100  → running balance 4763
```

`GET /balance` reads the running balance from the most recent entry. A reconciliation path sums every entry from scratch and asserts the two agree. They agree by construction because every write goes through one function.

**How each failure mode is prevented**

_Double-crediting a replayed Stripe webhook._ `Purchase.stripeSessionId` is unique, and `LedgerEntry.purchaseId` is unique. Stripe retries webhooks as a matter of course, so this has to be idempotent by construction rather than by careful checking.

_Double-charging a generation or deploy._ `LedgerEntry.generationId` and `.deploymentId` are unique. A generation can have at most one debit, enforced by the database.

_Race conditions._ `appendEntry()` runs inside a Prisma transaction. It reads the latest balance, checks sufficiency, and inserts the new row atomically. Two simultaneous requests cannot both read the same starting balance and both debit against it.

_Negative balances._ The transaction throws and rolls back if the resulting balance would be below zero. There is no window in which a debit is written despite insufficient funds.

_Client-side manipulation._ The client never sends a balance or a cost that the server trusts. Cost is computed server-side from the OpenRouter response; balance is computed server-side from the ledger. The client only reads.

---

## 7. Build order

| Phase | Work                                                                               | Done when                                                                                  |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1     | Monorepo, TypeScript config, Prisma init, both apps booting                        | `/health` returns 200, Vite page loads                                                     |
| 2     | Full schema, first migration, seeded user                                          | All six tables visible in Prisma Studio                                                    |
| 3     | Ledger service with transactional guard                                            | Credit/debit sequence produces correct balance; over-debit throws                          |
| 4     | `GET /api/balance`                                                                 | Endpoint returns live balance                                                              |
| 5     | Stripe checkout, webhook with signature verification and idempotent crediting      | Replaying the same webhook event credits the ledger exactly once                           |
| 6     | OpenRouter integration: system prompt, structured output parsing, usage extraction | A prompt returns a validated file map plus real usage numbers; malformed output is handled |
| 7     | Generation billing: usage → cost → ledger debit, with balance check first          | Generation succeeds with balance; is cleanly rejected without one, and no LLM call is made |
| 8     | Docker sandbox: build generated files in a throwaway container                     | Valid file set builds; broken file set fails with a readable error                         |
| 9     | Vercel deployment with fixed deploy fee debited                                    | Returned URL opens in a browser                                                            |
| 10    | Hosted HTML invoice, history and ledger endpoints                                  | Invoice renders; history returns purchases, generations, deployments                       |
| 11    | Frontend wiring: balance, buy, prompt, preview, deploy, ledger, invoices           | Full flow clickable end to end                                                             |
| 12    | CI workflow, README, secrets check, commit history review                          | CI green on push; README covers setup, architecture, tradeoffs                             |

---

## 8. Cut order under time pressure

The spec is explicit that a clean working 70% beats a broken 100%. If time runs out, I cut in this order and say so in the README:

1. Invoice styling and polish
2. Automated tests beyond ledger math and webhook idempotency
3. Additional token pack sizes
4. Sandbox sophistication beyond a basic isolated build

What does not get cut, because it is the assignment: webhook-verified crediting, metered deduction from real usage, server-side balance enforcement, the ledger view, one working deployment, passing CI, and a README that explains the tradeoffs.
