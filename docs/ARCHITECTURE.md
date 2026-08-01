# Architecture

## Scope

This document describes what is **actually implemented**. For the full target platform (per-tenant auth), see `PROJECT.md` — that piece does not exist in code yet. API key authentication (flat/global, not per-tenant) exists — see "Platform hardening" below and `docs/API.md`. The AI service (`apps/ai`, Sprint 3) exists and generates drafts only — see "AI pipeline" below; it never sends email and has no campaign/automation logic. The email delivery service (`apps/email`, Sprint 4) exists — see "Email delivery pipeline" below; it never sends without an explicit human approval step and has no reply automation. The admin dashboard (`apps/admin`, Sprint 5) exists — see "Admin dashboard" below; it is a client of the three backend services, not a fourth backend service (no database of its own).

## Data flow

```
Client
  │
  ▼
POST /api/v1/ingest/run {niche, platform}      (apps/backend)
  │  [rate limiter -> zod validation -> idempotency check]
  │
  ├─ 1. calls apps/python/search   /search    -> [candidate URLs]
  │       (cache-then-call: Redis search:{platform}:{niche}, TTL=CACHE_TTL)
  │       (retry -> circuit breaker -> timeout wraps the HTTP call)
  │
  ├─ 2. for each URL, calls apps/python/extractor /extract
  │       -> {email, social_links, bio, source_url}
  │
  ├─ 3. calls apps/python/validator /validate
  │       -> {is_valid, confidence_score, reasons[]}
  │       (cache-then-call: Redis validation:{email}, TTL=VALIDATION_TTL)
  │
  ├─ 4. checks Redis for creator:email:{email} / creator:website:{domain}
  │       -> if present, skip + log duplicate reason
  │
  └─ 5. writes Creator + Email + ValidationResult rows in Postgres
          (unique constraints on email/website back up the Redis check)
          -> idempotency result stored in Redis if an Idempotency-Key was given

GET /api/v1/creators?page=N              (apps/backend, paginated, indexed)
GET /api/v1/creators/:id                 (apps/backend, full detail incl. bio/socialLinks -- used by apps/ai)
GET /health, /ready, /metrics            (unversioned)
```

## AI pipeline (apps/ai, Sprint 3)

Standalone service, own process/port (`8004` by default), own Postgres schema (`ai`, isolated from the backend's `public` schema -- see `docs/DATABASE.md` "AI schema isolation"). Never sends email, never touches `apps/backend`'s tables directly.

```
POST /api/v1/ai/summary {creatorId}                              (apps/ai)
  │  [rate limiter -> API key auth -> zod validation]
  ├─ 1. GET apps/backend /api/v1/creators/:id  -> {bio, socialLinks, niche, ...}
  └─ 2. Creator Summary   (LLM call, prompt: prompts/creator-summary/v1.md)
          -> upserts creator_summaries, records ai_generations row

POST /api/v1/ai/brand-fit {creatorId, brand}                     (apps/ai)
  ├─ reuse stored Creator Summary if present, else run stage 1 above
  ├─ 2. Brand Analysis     (LLM call)
  ├─ 3. Creator Analysis   (LLM call, uses stages 1+2's output)
  └─ 4. Brand Fit Score    (LLM call, uses stages 1-3's output; parses "Score: 0.NN")

POST /api/v1/ai/draft {creatorId, brand}                         (apps/ai)
  ├─ stages 1-4 above (self-contained -- brand info isn't cached between
  │   requests, so /draft re-derives brand fit rather than requiring a prior
  │   /brand-fit call; see docs/API.md for the cost trade-off this implies)
  ├─ 5. Subject Generation (LLM call)
  ├─ 6. Email Draft        (LLM call)
  ├─ 7. Quality Review     (LLM call, spam-risk/quality check on the draft)
  └─ 8. Save Draft         -> draft_emails row, status="draft" always

GET /api/v1/ai/jobs/:id    (apps/ai, full job + all its ai_generations rows)
GET /health, /ready, /metrics   (apps/ai, unversioned)
```

Every LLM call (`apps/ai/src/services/pipeline.ts` `runStage()`) goes through the same choke point: resolve the versioned prompt (`prompts/<name>/v<N>.md`, never hardcoded -- `apps/ai/src/prompts/`), call `generateWithFallback()` (retry -> circuit breaker -> timeout on the primary provider; falls back to a second configured provider on any failure, including a missing API key), then record one `ai_generations` row (model, provider, prompt version, latency, tokens, estimated cost) and update the relevant Prometheus metrics. See `docs/API.md` "AI Service" for the full endpoint reference and provider-adapter design.

## Email delivery pipeline (apps/email, Sprint 4)

Standalone service, own Postgres schema (`email`, isolated from both `public` and `ai` -- see `docs/DATABASE.md` "Email schema isolation"). Unlike `apps/backend`/`apps/ai`, this service runs as **two processes**: an API process (`src/server.ts`, port `8005` by default) that only ever *enqueues* work, and a separate worker process (`src/queue/runWorker.ts`) that is the only code path that calls a provider's `send()`. Never sends an AI-generated draft automatically, never generates or approves its own campaigns, never inspects an inbox for replies.

```
POST /api/v1/campaigns {name, senderProfileId, recipients[]}    (apps/email API)
  │  [rate limiter -> API key auth -> zod validation]
  ├─ dedupe input recipient list (in-memory, before any DB write)
  ├─ check suppression_list for each recipient email
  └─ create campaign (status="pending_review") + campaign_recipients
       (status="pending" or "suppressed" per the check above)
       -- nothing has been sent; this call only records intent

POST /api/v1/campaigns/:id/approve {approvedBy}                 (apps/email API)
  └─ pending_review -> approved   [the human approval gate --
       services/campaignService.ts refuses every other status]

POST /api/v1/campaigns/:id/send                                 (apps/email API)
  ├─ refuses (409) unless status === "approved"
  ├─ approved -> queued
  └─ for each "pending" recipient, in creation order:
       enqueueSend(recipientId, {delayMs, priority})   -> BullMQ EMAIL_SEND_QUEUE
       (delay/priority spread per EMAIL_DELAY_MIN/MAX + MAX_EMAILS_PER_HOUR)
       campaign_recipient.status -> "queued"

  ⋯ separately-running worker process (src/queue/worker.ts) ⋯

BullMQ job picked up  -> processSendJob(recipientId)             (apps/email worker)
  ├─ re-check campaign.status still in {approved, queued, sending} -- refuse+fail otherwise
  ├─ re-check suppression_list again (state may have changed since enqueue)
  ├─ GET apps/ai /api/v1/ai/drafts/:draftEmailId  -> {subject, body}
  ├─ sendViaProvider(senderProfile.provider, {...})  -> provider adapter (mock/smtp/resend/ses/sendgrid)
  ├─ on success: campaign_recipient.status="sent", email_provider_logs row, email_events "sent" row
  ├─ on failure: email_provider_logs row (status="error"), rethrow -> BullMQ retry/backoff
  └─ on final exhausted retry: handleJobFailed -> EMAIL_SEND_DLQ + campaign_recipient.status="failed"

POST /api/v1/webhooks/{resend,sendgrid,ses}                     (apps/email API)
  └─ provider delivery event -> matched to campaign_recipient via providerMessageId
       -> email_events row + campaign_recipient.status updated
       -> "bounced" additionally upserts suppression_list

GET /api/v1/campaigns/:id/status, /email-events, /dashboard/*   (apps/email API, read-only)
GET /health, /ready, /metrics                                   (apps/email, unversioned)
```

Provider adapters (`apps/email/src/providers/`) mirror `apps/ai`'s pattern exactly: a minimal interface (`send()`), a `registry.ts` resolving by name, one file per provider, and a `MockEmailProvider` default that makes zero network calls -- used for every automated test and all live verification performed in this repo. See `docs/API.md` "Email Delivery Service" for the full endpoint reference, and `docs/SECURITY.md` for the webhook-authentication gap and the sending-without-approval prevention this pipeline is built around.

## Admin dashboard (apps/admin, Sprint 5; auth/RBAC/audit added Sprint 6)

Next.js 15 / React 19 App Router web app, TanStack Query for server state, React Hook Form + Zod for form validation, shadcn/ui (Base UI-backed, not Radix) for components, Recharts for the Analytics funnel, Auth.js (Credentials provider) for login. Not a fourth *business-logic* backend -- no `/api/v1/*` of its own, no copy of any other service's data, every page is a client of `apps/backend`/`apps/ai`/`apps/email` over HTTP, reached exclusively through this app's own server-side proxy. It does own a small Postgres schema (`admin`, same physical database, same isolation pattern as `ai`/`email`) for two tables only: `admin_users` (login) and `audit_log` -- the one deliberate exception to "no database of its own," scoped narrowly to what auth and a durable audit trail actually require:

```
Browser (client component)
  │  fetch("/api/proxy/<service>/<path>")           -- same-origin, no API key
  ▼
middleware.ts                                        -- Edge runtime, no Prisma/bcrypt
  │  requires a valid Auth.js session (JWT cookie) for every page and every /api/proxy/* call
  │  unauthenticated -> redirect to /login
  ▼
Next.js Route Handler (src/app/api/proxy/<service>/[...path]/route.ts)   -- Node runtime
  │  re-checks session (auth()) independently of middleware
  │  mutating request? -> classify permission (src/lib/permissionForRequest.ts)
  │    -> role lacks permission? 403 + audit_log row, stop here
  │  overwrites approvedBy/X-Reviewed-By with the session's real email
  │  attaches X-API-Key from server-only env (src/lib/serverEnv.ts, "server-only" import)
  │  forwards method/path/query/body, does NOT forward incoming cookies/auth
  │  writes an audit_log row (actor, role, action, method, path, status) for every mutation
  ▼
apps/backend | apps/ai | apps/email   (real service, real data, mock or real providers)
```

`auth.config.ts` (edge-safe: pages/callbacks only) vs `auth.ts` (full config, Credentials provider + Prisma + bcrypt, Node runtime only) are deliberately split -- `middleware.ts` runs in the Edge runtime, which cannot bundle Prisma or bcrypt; only the JWT-decode path needs to run there. Roles: `admin`, `reviewer` (draft review only), `operator` (campaigns/suppression/senders/queue/ingest), `readonly` (no mutations). See `docs/API.md` "Auth, roles, and audit log" for the full permission table and `docs/SECURITY.md` for what this does and doesn't protect against.

This is the same "browser never holds a backend credential" principle as every other cross-service boundary in this repo, applied to a UI instead of another API. See `docs/API.md` "Admin Dashboard" for the full proxy route list, composed-view endpoints (KPIs, campaign-recipient-email joins, analytics funnel) that reuse existing endpoints rather than adding aggregate ones, and what Playwright E2E testing found and fixed this sprint (two real bugs in generated shadcn `Command`/`Dialog` composition that silently broke click handling and crashed the command palette -- see the Sprint 5 RC report in `RELEASE.md`).

Three small **additive, read-mostly** backend endpoints were added specifically to back this UI (not architecture changes): `PATCH /ai/drafts/:id` (human approve/reject/edit, review-tracking only -- `apps/email` does not gate sending on it), `POST /campaigns/:id/{pause,resume}` (dequeue/re-enqueue, same safety model as the existing send gate), and `GET /dashboard/queue/dlq` + `POST .../retry` (surface + manually retry dead-lettered jobs). Full list in `docs/API.md`.

## Resilience layer

Each of the three HTTP calls to the Python services (`apps/backend/src/services/pipeline.ts`) is wrapped in a `cockatiel` policy (`apps/backend/src/services/resilience.ts`), one breaker instance per downstream service:

`retry (2 attempts, exponential backoff) -> circuit breaker (opens after CIRCUIT_BREAKER_THRESHOLD consecutive failures, half-open probe after 10s) -> timeout (REQUEST_TIMEOUT)`

When a breaker is open, the call fails immediately with `BrokenCircuitError` instead of hanging or retrying further; `/api/v1/ingest/run` maps that to `503`. Breaker state feeds the `circuit_breaker_state` metric.

## Platform hardening (readiness pass)

- **Authentication**: every `/api/v1/*` route requires `X-API-Key` (`apps/backend/src/middleware/apiKeyAuth.ts`), timing-safe comparison against `API_KEYS` (comma-separated, supports rotation), never logged in plaintext. Rate-limited both per-IP (pre-auth, anti-flood) and per-API-key (post-auth, per-tenant quota). See `docs/API.md`, `docs/SECURITY.md`.
- **SSRF guard**: `apps/python/extractor` validates the resolved target of every URL it fetches (and every redirect hop) against private/loopback/link-local/reserved address ranges before making the request (`_assert_safe_target`, `apps/python/extractor/main.py`) — see `docs/SECURITY.md` "SSRF".
- **Security headers**: `helmet()` on every response; CORS denies cross-origin browser requests by default (`CORS_ALLOWED_ORIGINS` to opt specific origins in) — API key auth alone doesn't make arbitrary origins safe.
- **Standard error envelope**: every non-2xx JSON response uses `{ error: { code, message, details?, requestId } }` (`apps/backend/src/middleware/errors.ts`) — see `docs/API.md`.
- **Startup validation**: `apps/backend/src/config/env.ts` fails fast on missing/malformed env vars (URLs validated, numeric vars range-checked) before the process starts listening; `server.ts` additionally logs (non-blocking) whether Postgres/Redis are actually reachable at boot.
- **Graceful shutdown**: `SIGTERM`/`SIGINT` stop accepting new connections, let in-flight requests finish, close the Prisma and Redis clients, then exit (10s force-exit ceiling) — see `server.ts`. Matters for zero-downtime rolling deploys; without it, in-flight `/ingest/run` pipeline runs get cut off on every deploy.
- **Slow-query instrumentation**: every Prisma query is timed via a client extension (`apps/backend/src/db.ts`), feeding `db_query_duration_seconds` and logging a `slow_query` event past 500ms — see `monitoring/README.md`.
- **API docs**: `GET /api-docs` serves the OpenAPI spec (`apps/backend/openapi.yaml`) as interactive Swagger UI.
- **CI**: `.github/workflows/ci.yml` — lint, typecheck, test, build, and an offline Prisma schema/migration drift check for the backend; `pytest` for each Python service. See `docs/TESTING.md`.
- **Monitoring**: `monitoring/grafana-dashboard.json` + `monitoring/prometheus-alerts.yml` — see `monitoring/README.md`.

## Correlation IDs and logging

`apps/backend` assigns/accepts an `x-request-id` per request (`src/logger.ts`, `pino` + `pino-http`), logs one structured JSON line per request, and forwards the same ID as a header on every call to the Python services. Each Python service (`apps/python/shared/request_logging.py`) reads that header (or generates its own if missing), logs one JSON line per request including the ID, and echoes it back — so one request can be traced across all four processes by request ID.

## Service responsibilities

| Service | Responsibility | Does NOT do |
|---|---|---|
| `apps/python/search` | Given `{platform, niche}`, return candidate profile/website URLs from official sources | Never regexes emails out of search snippets |
| `apps/python/extractor` | Fetch a given URL, extract email/social/bio from the real page | No DB writes |
| `apps/python/validator` | Syntax + MX + disposable-domain check, confidence score | No DB writes, never fabricates data |
| `apps/backend` | All business logic, Postgres, Redis, API, orchestration | Never runs its own search/scrape logic — delegates to the Python services |
| `apps/ai` | Creator summaries, brand-fit analysis, email draft generation via LLM providers | Never sends email, never touches `apps/backend`'s tables directly (reads creator data over HTTP), no campaign/automation logic |
| `apps/email` | Campaign/recipient management, approval-gated queueing, provider-adapter sending, delivery event tracking, suppression | Never auto-sends a draft, never approves its own campaigns, never automates replies, never generates AI content (reads drafts from `apps/ai` over HTTP) |
| `apps/admin` | Internal dashboard/CRM UI: creator browsing, draft review, campaign management, queue/analytics visibility, login/RBAC/audit | No business logic of its own -- every data action is a proxied call to one of the three services above; never holds a backend API key client-side. Its own `admin` schema holds only login + audit data, never a copy of another service's data |

This split matches PROJECT.md §7 exactly: Python services are stateless and read-only; the Node backend owns all persistence and business rules; `apps/ai` owns only its own AI-specific tables (`docs/DATABASE.md` "AI schema isolation") and reaches creator data through the backend's API, never its database; `apps/email` owns only its own delivery-specific tables and reaches draft content through `apps/ai`'s API, never its database; `apps/admin` owns no tables at all and reaches all three backend services only through its own server-side proxy (`docs/API.md` "Admin Dashboard").

## Explicitly not built yet

Per-tenant/scoped auth (today's API keys are flat/global, and `apps/admin` itself has no login/roles yet -- see `docs/SECURITY.md` "Known operational limits"), automatic mass sending (`apps/email` requires per-campaign human approval for every send, by design -- see PROJECT.md's non-goals), reply automation (replies are marked manually via `POST /campaigns/:id/recipients/:recipientId/mark-replied`, never detected/acted on automatically), a "sweep completed campaigns" job (`campaign.status` doesn't automatically reach `"completed"` -- see `DEPLOYMENT.md` "Known operational limits"), per-provider webhook HMAC signature verification (`docs/SECURITY.md` "Webhook authentication"), SES/SNS bounce event parsing (`docs/API.md`), cross-service enforcement of `apps/ai`'s draft approve/reject status (`apps/email` doesn't currently refuse to send a `"rejected"` draft -- review-tracking only in this slice). `apps/backend`'s ingest pipeline and `apps/ai`'s pipeline stages both still run synchronously within the request, not via a queue -- `apps/email` is the only service with a queue (BullMQ) so far. Do not assume any of the above exists when reasoning about the system. AI personalization (`apps/ai`), email delivery (`apps/email`), and the admin dashboard (`apps/admin`) are now all implemented -- see "AI pipeline", "Email delivery pipeline", and "Admin dashboard" above.
