# API (apps/backend)

Base URL: `http://localhost:4000`

All application routes are versioned under `/api/v1`. `/health`, `/ready`, and `/metrics` are unversioned — infra probes and scrapers shouldn't need to track API version.

## Authentication

Every `/api/v1/*` route requires an API key via the `X-API-Key` header. `/health`, `/ready`, `/metrics`, and `/api-docs` do not require one.

```bash
curl http://localhost:4000/api/v1/creators -H "X-API-Key: <your key>"
```

Missing or invalid keys get `401` (`{error:{code:"unauthorized", ...}}`). Keys are configured via `API_KEYS` (comma-separated, see `.env.example`) — comparison is timing-safe (`apps/backend/src/middleware/apiKeyAuth.ts`), and the raw key is never logged (a short hash prefix identifies the caller in logs/metrics instead).

**Rotation**: add the new key to `API_KEYS` alongside the old one and deploy; both authenticate during the overlap window. Once every caller has switched, remove the old key and deploy again. No downtime, no coordinated cutover required.

## Correlation IDs

Every request gets an `x-request-id` (accepted from the incoming request if present, otherwise generated). It's echoed back in the response header, included in every structured log line for that request, and forwarded to each downstream Python service call so one request can be traced end-to-end across all four processes.

## Interactive docs

The OpenAPI spec (`apps/backend/openapi.yaml`) is served as interactive Swagger UI at unversioned `GET /api-docs` — no auth, read-only.

## Standard error format

Every non-2xx JSON response (validation errors, rate limiting, downstream failures, 404s, uncaught errors) uses the same envelope:

```json
{
  "error": {
    "code": "invalid_body",
    "message": "invalid body",
    "details": [ /* present for validation errors: zod issue list */ ],
    "requestId": "..."
  }
}
```

`code` is a stable machine-readable string (`invalid_body`, `invalid_query`, `idempotency_in_progress`, `service_unavailable`, `bad_gateway`, `rate_limited`, `not_found`, `internal_error`) — safe to branch on in client code instead of parsing `message`.

## `POST /api/v1/ingest/run`

Runs the search -> extract -> validate -> store pipeline for a niche/platform.

**Body** (validated with zod)
```json
{ "niche": "couple vlog", "platform": "instagram" }
```
- `niche`: string, 1-200 chars
- `platform`: one of `instagram`, `youtube`, `tiktok`

**Headers**
- `Idempotency-Key` (optional): if supplied, a repeated request with the same key within `IDEMPOTENCY_TTL_SECONDS` (default 24h) returns the original response without re-running the pipeline. A second request with the same key while the first is still in flight gets `409`.

**Response `200`**
```json
{
  "requested": 12,
  "extracted": 9,
  "validated": 6,
  "stored": 4,
  "skippedDuplicates": 2
}
```

**Errors**: `400` invalid body, `401` missing/invalid API key, `409` duplicate in-flight idempotency key, `502` a Python service failed, `503` a Python service's circuit breaker is open (fails fast instead of hanging/retrying further), `429` rate limit exceeded (`INGEST_RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`, per API key, stricter than the general limit).

**Caching**: search results are cached per `{platform, niche}` for `CACHE_TTL` seconds; validation results are cached per email for `VALIDATION_TTL` seconds. Repeated runs for the same niche, or emails already validated in a prior run, skip the Python service call entirely.

## `GET /api/v1/creators`

Paginated list of stored creators.

**Query params** (validated with zod): `page` (default 1), `pageSize` (default 20, clamped to max 100 — not rejected), `niche`, `platform` (one of `instagram`/`youtube`/`tiktok` if provided)

**Response `200`**
```json
{
  "page": 1,
  "pageSize": 20,
  "total": 4,
  "items": [
    {
      "id": "...",
      "handle": "@example",
      "platform": "instagram",
      "niche": "couple vlog",
      "email": "contact@example.com",
      "confidenceScore": 0.92
    }
  ]
}
```

**Errors**: `400` invalid query (e.g. unsupported `platform`, non-numeric `page`), `401` missing/invalid API key.

## `GET /api/v1/creators/:id`

Single-creator detail, including `bio`/`socialLinks` (omitted from the list endpoint above to keep pagination payloads small). Added for `apps/ai` (Sprint 3), which needs real creator content to summarize.

**Response `200`**
```json
{
  "id": "...",
  "handle": "@example",
  "platform": "instagram",
  "niche": "couple vlog",
  "websiteUrl": "https://instagram.com/example",
  "bio": "We are a couple who loves to travel.",
  "socialLinks": ["https://instagram.com/example", "https://youtube.com/example"],
  "email": "contact@example.com",
  "confidenceScore": 0.92,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

**Errors**: `400` invalid (non-UUID) id, `401` missing/invalid API key, `404` no creator with that id.

## `GET /health`

Liveness only — process is up. Always fast, no dependency checks.

## `GET /ready`

Readiness — checks Postgres (`SELECT 1`), Redis (`PING`), and each Python service's own `/health`. Returns `200` with per-dependency status if all pass, `503` otherwise.

```json
{
  "status": "ready",
  "checks": [
    { "name": "postgres", "ok": true },
    { "name": "redis", "ok": true },
    { "name": "search", "ok": true },
    { "name": "extractor", "ok": true },
    { "name": "validator", "ok": true }
  ]
}
```

## `GET /metrics`

Prometheus exposition format. Tracks: `http_request_duration_seconds` (by method/route/status), `ingest_stage_total` (by pipeline stage), `circuit_breaker_state` (per downstream service), `cache_result_total` (hit/miss per cache), plus Node process defaults.

## Rate limiting

Two layers, both Redis-backed fixed windows (shared across backend instances):

1. **Per-IP**, applied before auth so it also bounds unauthenticated/brute-force traffic: `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS` (default 120/min).
2. **Per-API-key**, applied after auth: `API_KEY_RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS` (default 300/min) — each credentialed caller gets its own quota independent of how many keys share an IP (NAT, shared egress). `POST /api/v1/ingest/run` additionally has its own stricter per-key limiter (`INGEST_RATE_LIMIT_MAX`, default 10/min) since it's the expensive pipeline entry point.

Standard `RateLimit-*` headers are returned on every response. If Redis itself is unreachable both limiters fail open (see `docs/SECURITY.md`) and log/increment `redis_operation_failures_total{component="rate_limit"}` rather than silently under-enforcing.

## CORS and security headers

`helmet()` sets standard security headers (`X-Content-Type-Options`, `X-DNS-Prefetch-Control`, etc.) on every response. Cross-origin browser requests are denied by default — API key auth alone doesn't make arbitrary origins safe (a browser caller would need to expose its key client-side). Set `CORS_ALLOWED_ORIGINS` (comma-separated) to allow specific, trusted origins once a real frontend exists.

## Internal Python services (not public-facing, called only by `apps/backend`)

- `POST http://localhost:8001/search` — `{platform, niche}` -> `{urls: string[]}` (platform restricted to `instagram`/`youtube`/`tiktok`, niche 1-200 chars, enforced by Pydantic)
- `POST http://localhost:8002/extract` — `{url}` -> `{email, social_links, bio, source_url}` (`url` must be a well-formed HTTP(S) URL)
- `POST http://localhost:8003/validate` — `{email}` -> `{is_valid, confidence_score, reasons}` (`email` 3-320 chars)
- Each accepts/echoes `x-request-id` and exposes `GET /health`

Not yet implemented: campaigns, email-sending endpoints, per-tenant/multi-user auth (API keys today are flat/global, not tied to an account or scoped to specific permissions).

---

# AI Service (apps/ai) -- Sprint 3

Base URL: `http://localhost:8004` (own process, own port -- standalone, not proxied through `apps/backend`). Stateless: any request can hit any instance; all state lives in Postgres (its own `ai` schema) and Redis.

Generates AI personalization **drafts only**. This service never sends email, never triggers `apps/backend`'s ingest pipeline, and has no campaign/automation logic of any kind -- draft rows it creates always have `status: "draft"` and there is no code path that changes that.

## Authentication

Identical mechanism to `apps/backend` (see above), separate key set: every `/api/v1/ai/*` route requires `X-API-Key` from `AI_API_KEYS` (comma-separated, same rotation procedure). `/health`, `/ready`, `/metrics` do not require one.

```bash
curl -X POST http://localhost:8004/api/v1/ai/summary \
  -H "Content-Type: application/json" -H "X-API-Key: <your key>" \
  -d '{"creatorId": "<uuid>"}'
```

## Standard error format

Same envelope as `apps/backend` (`{error:{code,message,details?,requestId}}`), plus two AI-specific codes: `creator_not_found` (the `creatorId` doesn't exist in `apps/backend`), `provider_unavailable` (reserved, not currently returned -- provider failures degrade via fallback instead, see below).

## Pipeline

```
Creator (fetched from apps/backend) -> Creator Summary -> Brand Analysis -> Creator Analysis
  -> Brand Fit Score -> Subject Generation -> Email Draft -> Quality Review -> Save Draft
```

Split across 3 endpoints:

### `POST /api/v1/ai/summary`

Runs stage 1 only (Creator Summary). Always regenerates and overwrites the stored summary for this creator (idempotent by design, not "first write wins").

**Body**: `{ "creatorId": "<uuid>" }`

**Response `200`**
```json
{
  "jobId": "...",
  "summary": { "id": "...", "summary": "...", "keyThemes": ["vegan", "cooking"] }
}
```

### `POST /api/v1/ai/brand-fit`

Runs stages 2-4 (Brand Analysis, Creator Analysis, Brand Fit Score). Reuses an existing stored Creator Summary if one exists for this creator (regardless of which endpoint created it) rather than regenerating it -- pass `forceRegenerateSummary: true` to force a fresh one.

**Body**
```json
{
  "creatorId": "<uuid>",
  "forceRegenerateSummary": false,
  "brand": { "name": "...", "description": "...", "values": "...", "targetAudience": "..." }
}
```
`brand.name`/`brand.description` required; `values`/`targetAudience` optional. There is no persisted "brand" entity in this slice -- brand info is supplied fresh on every call.

**Response `200`**
```json
{
  "jobId": "...",
  "creatorSummary": "...",
  "brandAnalysis": "...",
  "creatorAnalysis": "...",
  "fitScore": 0.82,
  "fitReasoning": "..."
}
```
`fitScore` is `null` if the model's response didn't match the expected `Score: 0.NN` format (logged, not retried automatically within this call -- see "Reliability").

### `POST /api/v1/ai/draft`

Runs stages 2-8 end to end (self-contained: internally re-derives brand fit the same way `/brand-fit` does, since brand info isn't cached between requests -- see `docs/ARCHITECTURE.md` "AI pipeline" for why). Same body shape as `/brand-fit`.

**Response `200`**
```json
{
  "jobId": "...",
  "draft": {
    "id": "...",
    "subject": "...",
    "body": "...",
    "brandFitScore": 0.82,
    "qualityScore": 0.9,
    "qualityNotes": "...",
    "status": "draft"
  },
  "fitReasoning": "..."
}
```

**Errors** (all 3 POST endpoints): `400` invalid body, `401` missing/invalid API key, `404` `creator_not_found`, `429` rate limited.

### `GET /api/v1/ai/jobs/:id`

Full detail for a job, including every generation it produced (model, provider, latency, tokens, cost, whether the fallback provider was used).

**Response `200`**
```json
{
  "id": "...",
  "creatorId": "...",
  "jobType": "draft",
  "status": "completed",
  "input": { "...": "..." },
  "result": { "...": "..." },
  "error": null,
  "startedAt": "...",
  "completedAt": "...",
  "generations": [
    { "id": "...", "stage": "brand_analysis", "provider": "openai", "model": "gpt-4o-mini", "latencyMs": 842, "promptTokens": 210, "completionTokens": 96, "totalTokens": 306, "estimatedCostUsd": 0.00009, "usedFallback": false, "createdAt": "..." }
  ]
}
```
`status` is `"pending"`, `"processing"`, `"completed"`, or `"failed"`. Note: jobs are processed synchronously within the originating request today (no queue infra exists yet, matching `apps/backend`'s own "no BullMQ yet" state) -- `GET /jobs/:id` is for re-fetching a past result, not polling an in-flight one.

## Provider adapters

Never locked to one provider. `AI_PRIMARY_PROVIDER` / `AI_FALLBACK_PROVIDER` (env, one of `openai`/`anthropic`/`gemini`/`mock`) select which. Adding a fourth provider requires only a new file implementing the 5-line `AiProvider` interface (`apps/ai/src/providers/types.ts`) -- no changes anywhere else.

## Reliability

- **Retry + timeout + circuit breaker** per provider (`cockatiel`, same library/pattern as `apps/backend`'s downstream-service calls) -- `AI_REQUEST_TIMEOUT_MS` (default 30s), `AI_CIRCUIT_BREAKER_THRESHOLD` (default 5 consecutive failures).
- **Fallback provider**: if the primary provider's call fails for any reason -- including a missing/invalid API key, a timeout, or an open circuit breaker -- the fallback provider is tried once before the request fails. Logged as `ai_provider_fallback`, counted in `ai_fallback_used_total`.
- **Rate limiting**: same two-layer per-IP + per-API-key pattern as `apps/backend` (`RATE_LIMIT_MAX`, `API_KEY_RATE_LIMIT_MAX`), fails open on a Redis outage.
- **Structured logging**: `pino`/`pino-http`, `X-API-Key`/`Authorization`/`Cookie` redacted from every log line (applied from day one here, not found-and-fixed later -- see `docs/SECURITY.md`).

### `GET /api/v1/ai/drafts/:id`

Fetch a single draft by id directly (without its parent job). Added for `apps/email` (Sprint 4), which needs to pull a draft's `subject`/`body` at send time without carrying the whole job payload around.

**Response `200`**
```json
{
  "id": "...",
  "creatorId": "...",
  "jobId": "...",
  "subject": "...",
  "body": "...",
  "brandFitScore": 0.82,
  "qualityScore": 0.9,
  "qualityNotes": "...",
  "status": "draft",
  "createdAt": "..."
}
```

**Errors**: `400` invalid (non-UUID) id, `401` missing/invalid API key, `404` no draft with that id.

## `GET /health`, `GET /ready`, `GET /metrics`

Same shape/semantics as `apps/backend`. `/ready` checks Postgres (`ai` schema), Redis, and `apps/backend`'s own `/health` -- deliberately does **not** check any AI provider (a provider outage is expected/recoverable via fallback, not a reason to pull this service out of rotation). `/metrics` adds `ai_generation_duration_seconds`, `ai_tokens_total`, `ai_estimated_cost_usd_total`, `ai_provider_failures_total`, `ai_fallback_used_total`, `circuit_breaker_state{provider}` on top of the same base metrics `apps/backend` exposes.

---

# Email Delivery Service (apps/email) -- Sprint 4

Base URL: `http://localhost:8005` (own process, own port -- standalone, not proxied through `apps/backend` or `apps/ai`). Owns its own Postgres schema (`email`) and reads drafts from `apps/ai` over HTTP (`aiClient.ts`) rather than sharing a database connection. Runs as **two processes**: the API (`npm start`) and a separate BullMQ worker (`npm run worker`, see `docs/DEPLOYMENT.md`) that actually calls the provider adapter -- the API process never sends an email itself, it only enqueues.

This service never sends an AI draft automatically and never auto-generates a campaign. Every campaign starts as `pending_review` and only a human calling `POST /campaigns/:id/approve` can move it forward -- there is no code path that skips this (`services/campaignService.ts`'s `sendCampaign()` throws `InvalidStateTransitionError` for any status other than `"approved"`).

## Authentication

Identical mechanism to `apps/backend`/`apps/ai`: every `/api/v1/*` route (except `/webhooks/*`, see below) requires `X-API-Key` from `EMAIL_API_KEYS`. `/health`, `/ready`, `/metrics` do not require one.

```bash
curl -X POST http://localhost:8005/api/v1/campaigns \
  -H "Content-Type: application/json" -H "X-API-Key: <your key>" \
  -d '{"name": "...", "senderProfileId": "<uuid>", "recipients": [...]}'
```

**Webhooks** (`/api/v1/webhooks/*`) are the one exception: providers can't send an `X-API-Key` header, so they're protected instead by an optional shared-secret token (`WEBHOOK_SHARED_SECRET`, checked via query param `?token=` or `X-Webhook-Token` header). If unset, webhook routes accept unauthenticated requests -- acceptable for local/dev, **not** for real production use. See `docs/SECURITY.md` "Webhook authentication" for the gap this leaves (no per-provider HMAC signature verification) and what to add before going live with a real provider account.

## Standard error format

Same envelope as the other two services, plus `invalid_state_transition` (409) -- returned whenever an action is attempted against a campaign that isn't in the required status (e.g. approving an already-approved campaign, sending one that hasn't been approved).

## Campaign lifecycle

```
draft (implicit) -> pending_review -> approved -> queued -> sending -> completed
```

- `pending_review`: set automatically by `POST /campaigns` -- every campaign starts here, never anywhere further along.
- `approved`: only reachable via `POST /campaigns/:id/approve`, which records `approvedBy` and `approvedAt`.
- `queued` / `sending`: set by `POST /campaigns/:id/send` and the worker as recipients are enqueued/picked up.
- `completed`: not currently set automatically in this slice (no "all recipients terminal" sweep job exists yet -- see Future Improvements in the RC report); `GET /campaigns/:id/status`'s per-status `recipientCounts` is the reliable way to tell when a campaign has finished.

### `POST /api/v1/campaigns`

Creates a campaign in `pending_review` and its recipient rows. Runs both de-duplication (same email listed twice in one request -- second occurrence dropped, `email_duplicate_skipped_total` incremented) and suppression-list checks (a suppressed address is stored with `status: "suppressed"`, not silently dropped, so it's still visible in `recipientCounts`) at creation time. **This does not send anything** -- it only stores intent.

**Body**
```json
{
  "name": "Q3 creator outreach",
  "senderProfileId": "<uuid>",
  "recipients": [
    { "creatorId": "<uuid>", "draftEmailId": "<uuid>", "email": "creator@example.com" }
  ]
}
```
`recipients`: 1-1000 entries.

**Response `201`**: the created campaign, including its `recipients` array (each with `status`: `pending` or `suppressed`).

**Errors**: `400` invalid body, `401` missing/invalid API key.

### `POST /api/v1/campaigns/:id/approve`

The human approval gate. Moves `pending_review` -> `approved`.

**Body**: `{ "approvedBy": "jane@makeable.example" }`

**Response `200`**: the updated campaign.

**Errors**: `400` invalid body/id, `401`, `404`, `409` `invalid_state_transition` (campaign isn't `pending_review`).

### `POST /api/v1/campaigns/:id/send`

Enqueues every `pending` recipient onto the BullMQ send queue, spacing each one's delay per `EMAIL_DELAY_MIN_SECONDS`/`EMAIL_DELAY_MAX_SECONDS`/`MAX_EMAILS_PER_HOUR` (`docs/DEPLOYMENT.md`'s env reference) and moves the campaign to `queued`. Refuses (409) unless the campaign is currently `approved` -- this is the hard safety boundary described above, not just a UX nicety.

**Response `200`**: `{ "campaignId": "...", "enqueued": 42 }`

**Errors**: `400` invalid id, `401`, `404`, `409` `invalid_state_transition` (campaign isn't `approved`).

### `GET /api/v1/campaigns/:id/status`

Campaign detail plus a per-status recipient count breakdown (`pending`, `suppressed`, `queued`, `sent`, `delivered`, `deferred`, `bounced`, `opened`, `clicked`, `replied`, `failed`).

**Response `200`**
```json
{
  "id": "...",
  "name": "...",
  "status": "sending",
  "approvedBy": "jane@makeable.example",
  "approvedAt": "...",
  "sendStartedAt": "...",
  "completedAt": null,
  "recipientCounts": { "sent": 30, "queued": 12 }
}
```

### `GET /api/v1/email-events`

Paginated, filterable event log (every `queued`/`sent`/`delivered`/`deferred`/`bounced`/`opened`/`clicked`/`replied`/`failed` transition, one row per event -- not just current status).

**Query params**: `page` (default 1), `pageSize` (default 50, clamped to 200), `campaignId` (uuid, optional), `eventType` (optional).

**Response `200`**: `{ page, pageSize, total, items: [{ id, campaignId, campaignRecipientId, email, eventType, providerMessageId, metadata, occurredAt }] }`

### `POST /api/v1/sender-profiles` / `GET /api/v1/sender-profiles`

Not in the literal Sprint 4 endpoint list, but structurally required -- a campaign references a `senderProfileId` and there's no other way to create one (same "small, necessary, additive endpoint" precedent as `GET /creators/:id` in RC1 and `GET /ai/drafts/:id` in Sprint 3). Create takes `{ name, fromEmail, fromName, replyTo?, provider }` where `provider` is one of `mock`/`smtp`/`resend`/`ses`/`sendgrid`; list returns all profiles.

### `POST /api/v1/suppression` / `GET /api/v1/suppression`

Manual suppression-list management (unsubscribe requests, compliance holds) -- also additive, needed since the Sending Rules require respecting a suppression list that has to originate somewhere besides automatic bounce handling. `POST` upserts by (lowercased) email: `{ email, reason: "bounced"|"complained"|"manual"|"unsubscribed", source? }`. `GET` returns the most recent 500 entries.

### `POST /api/v1/campaigns/:id/recipients/:recipientId/mark-replied`

Manual-only reply marking -- explicitly **not** automated per the Sprint 4 rule "no reply automation." This service never inspects an inbox; a human (or an external tool a human operates) calls this after observing a reply. Sets the recipient's status to `replied` and records an `email_event`.

## `POST /api/v1/webhooks/{resend,sendgrid,ses}`

Provider delivery-event callbacks (delivered/deferred/bounced/opened/clicked), normalized into the same `email_events` table regardless of provider. Matched back to a `campaign_recipient` via the `providerMessageId` recorded in `email_provider_logs` at send time; an event for a `providerMessageId` this service doesn't recognize is logged (`webhook_event_unmatched`) and dropped, not errored. A `bounced` event automatically upserts a `suppression_list` row (`source: "webhook:<provider>"`) so future campaigns skip that address without needing a human to notice the bounce first.

`ses` currently only logs receipt -- SES delivers events via SNS, which requires handling the `SubscriptionConfirmation` handshake out-of-band before real events arrive; not implemented in this slice (see `docs/DEPLOYMENT.md`).

**Auth**: shared-secret token, not per-provider HMAC signature verification -- see `docs/SECURITY.md` "Webhook authentication" before relying on this against a real provider account.

## Dashboard API

Read-only aggregate views, same auth as the rest of `/api/v1/*`.

- `GET /api/v1/dashboard/campaigns` -- most recent 50 campaigns with status/timestamps.
- `GET /api/v1/dashboard/queue` -- live BullMQ counts: `waiting`, `active`, `delayed`, `failed`, `completed`, `deadLetter`.
- `GET /api/v1/dashboard/providers` -- last-24h send success/error counts grouped by provider.
- `GET /api/v1/dashboard/rates?campaignId=<uuid>` (campaignId optional, defaults to all-campaigns aggregate) -- `bounceRate`/`replyRate`/`failureRate` computed only over recipients past `pending`/`queued`/`suppressed` (an in-flight campaign's rate is meaningless until sending has actually happened).

## Provider adapters

Same pattern as `apps/ai`'s AI provider adapters: a 2-method `EmailProvider` interface (`send`, `apps/email/src/providers/types.ts`), a `registry.ts` resolving by name (`mock`/`smtp`/`resend`/`ses`/`sendgrid`), one implementation file per provider, `MockEmailProvider` as the default/testing implementation that never makes a network call. Each `senderProfile.provider` value selects independently -- different campaigns can send through different providers without any code change.

## Queue

BullMQ (`EMAIL_SEND_QUEUE`), one job per recipient, `attempts`/exponential `backoff`/`priority`/`delay` all set at enqueue time by `sendCampaign()`. Jobs that exhaust every retry attempt are moved to a dedicated DLQ queue (`EMAIL_SEND_DLQ`, `removeOnFail: false` on the main queue so failed jobs stay inspectable) and the recipient is marked `failed` -- visible via `GET /campaigns/:id/status` without needing direct queue access. See `docs/DEPLOYMENT.md` for running the worker process and DLQ operational notes.

## Reliability

- **Suppression re-checked twice**: once at `POST /campaigns` (creation time) and again by the worker immediately before the provider call (send time, possibly days later) -- an address can be suppressed in the gap between creating and sending a campaign.
- **Campaign status re-checked at send time** too, defensively, even though `sendCampaign()`'s own guard should make an unapproved campaign's recipients unreachable by the worker.
- **Rate limiting**: same two-layer per-IP + per-API-key pattern as the other two services, one shared limiter instance per `/api/v1` prefix (a double-mounted limiter bug was found and fixed during this sprint -- see `docs/SECURITY.md` and the regression test in `tests/hardening.test.ts`).
- **Structured logging**: `pino`/`pino-http`, `X-API-Key`/`Authorization`/`Cookie` redacted from every log line.

## `GET /health`, `GET /ready`, `GET /metrics`

Same shape/semantics as the other two services. `/ready` checks Postgres (`email` schema), Redis, and the BullMQ queue's connection. `/metrics` adds `email_events_total{eventType}`, `email_duplicate_skipped_total`, `email_suppressed_total`, `queue_jobs_total{status}` on top of the shared base metrics.
