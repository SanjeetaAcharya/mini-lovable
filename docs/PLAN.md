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
- OpenRouter integration (Phase 6). `services/llm.service.ts` exports `generateSite(prompt)`: calls OpenRouter with a system prompt that forces bare-JSON output (`{"files": {...}}`, `index.html` required, no prose/fences/frameworks/CDNs), then parses and validates the response into a `FileMap`. Returns a `{status: "success" | "invalid_output" | "error"}` result — never throws on a bad model response. Malformed-output handling covers: prose with no JSON, markdown-fenced JSON (recovered), missing `index.html`, path traversal in a file name, truncated JSON, network failure, and a live 400 from an invalid model ID — each returns a diagnosable reason instead of crashing. Real token usage (`prompt_tokens`, `completion_tokens`, and `cost` when OpenRouter reports it) is read off the actual response via `usage: {include: true}`, not estimated. Verified live against `OPENROUTER_MODEL` (read from env, no hardcoded model): a real prompt returned a valid two-file site (`index.html` + `styles.css`) with real usage numbers. Not yet wired to billing or persistence — that's Phase 7.

**In progress**

- Generation billing (Phase 7) not yet started.

**Remaining**

Generation billing → sandboxed build → Vercel deployment → invoices and history → frontend → CI, README, walkthrough video.

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
