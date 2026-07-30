# Architecture

## Scope

This document describes what is **actually implemented**. For the full target platform (frontend, AI service, email service, campaigns), see `PROJECT.md` — those pieces do not exist in code yet. API key authentication (flat/global, not per-tenant) does exist — see "Platform hardening" below and `docs/API.md`.

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
GET /health, /ready, /metrics            (unversioned)
```

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

This split matches PROJECT.md §7 exactly: Python services are stateless and read-only; the Node backend owns all persistence and business rules.

## Explicitly not built yet

AI personalization, email-sending/SMTP, campaigns, rate-limited daily sending, BullMQ queue, Next.js frontend, per-tenant/scoped auth (today's API keys are flat/global). Do not assume these exist when reasoning about the system.
