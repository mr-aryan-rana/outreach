# Deployment

Covers `apps/backend` (Node/TS/Express/Prisma) and the three Python services (`apps/python/search`, `apps/python/extractor`, `apps/python/validator`). There is no frontend, AI service, or email-sending service yet — see `PROJECT.md`.

## Prerequisites

- A Supabase project (Postgres) — pooled connection string (port `6543`, `pgbouncer=true`) for runtime, direct connection string (port `5432`) for migrations
- An Upstash Redis database — TLS (`rediss://`) connection string
- Node.js 20+, Python 3.11+
- Never commit `.env`, and never let anything auto-load a `.env` file that happens to be sitting in the working directory — `apps/backend/tests/integration/` deliberately requires credentials to be exported explicitly in-shell for this reason (see `docs/TESTING.md`, `docs/SECURITY.md`). This project has twice had an unrelated project's live secrets appear as a stray `.env` in this repo; always verify a `.env`'s contents actually belong to MakeAble (`DATABASE_URL`/`DIRECT_URL`/`REDIS_URL`/`SEARCH_SERVICE_URL`/etc., per `.env.example`) before using it for anything.

## First-time deployment

1. **Provision infra**: create the Supabase project and Upstash database. Copy `.env.example` to `.env` in `apps/backend` and fill in `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`.
2. **Apply the schema**:
   ```bash
   cd apps/backend
   npm install
   npx prisma migrate deploy
   npx prisma migrate status   # confirm no drift
   ```
   This applies `prisma/migrations/20260101000000_init/migration.sql`, creating `Creator`, `Email`, `ValidationResult` with the indexes/unique constraints/FKs defined in `prisma/schema.prisma` (see `docs/DATABASE.md`).
3. **Verify schema against Supabase directly** (belt-and-braces beyond `migrate status`):
   ```sql
   select table_name from information_schema.tables where table_schema = 'public';
   select indexname, tablename from pg_indexes where schemaname = 'public';
   select conname, conrelid::regclass, confrelid::regclass from pg_constraint where contype = 'f';
   ```
4. **Seed (optional, non-prod only)**: `npx prisma db seed`.
5. **Deploy the Python services** (`search`, `extractor`, `validator`) — each is a standalone FastAPI app (`pip install -r requirements.txt && uvicorn main:app`). They are stateless and horizontally scalable; no shared state between instances.
6. **Deploy the backend** (`npm run build && npm start`, or `npm run dev` for non-prod). Set `SEARCH_SERVICE_URL`/`EXTRACTOR_SERVICE_URL`/`VALIDATOR_SERVICE_URL` to the deployed Python service addresses, and `CORS_ALLOWED_ORIGINS` if a browser frontend needs to call this API directly (empty = deny all cross-origin requests, the correct default while there's no auth layer).
7. **Verify**: `GET /health` (liveness), `GET /ready` (checks Postgres + Redis + all three Python services, `apps/backend/src/routes/health.ts`), `GET /metrics` (Prometheus), `GET /api-docs` (Swagger UI).
8. **Send SIGTERM, not SIGKILL, on deploy/restart**: the backend handles `SIGTERM`/`SIGINT` with a graceful drain (finish in-flight requests, close Prisma/Redis, 10s force-exit ceiling — `apps/backend/src/server.ts`). Whatever orchestrator manages the process (systemd, Kubernetes, ECS, PM2) must be configured to send a graceful-stop signal and wait for exit, not hard-kill.

## Subsequent deployments

- New migrations: author with `npx prisma migrate dev` locally, commit the generated SQL, then `npx prisma migrate deploy` in the target environment. Never hand-edit the schema or run `migrate dev` against production. CI (`.github/workflows/ci.yml`) runs `npm run prisma:check` on every push to catch schema/migration drift before it reaches this step.
- Python services and the backend can be deployed independently — the backend calls them over HTTP and treats failures as recoverable (retry → circuit breaker → timeout, see below), so a rolling deploy of one Python service does not require simultaneous backend downtime, as long as it stays within `REQUEST_TIMEOUT`.
- Config changes only (env vars, rate limit thresholds): restart the backend process; no migration needed.
- CI gate before merge: lint, typecheck, `npm test`, build, Prisma drift check (backend); `pytest` (each Python service). None of this touches real Supabase/Upstash — see `docs/TESTING.md` for how the opt-in real-cloud integration suite is run separately, by hand, never in CI.

## Zero-downtime rolling deploys

Verified live (RC2): ran two backend instances simultaneously against the same real Supabase/Upstash, confirmed rate-limit counters and idempotency results are shared correctly across them (a request started on one instance and replayed with the same `Idempotency-Key` on the other returns the identical cached result, not a re-run). This is the actual property a rolling deploy depends on — old and new instances serving traffic side-by-side during the rollout window behave as one logical service, not two independent ones, because all shared state lives in Redis/Postgres, never in backend process memory.

What this does *not* cover: the OS-signal-triggered graceful-drain half of a rolling deploy (old instance finishing in-flight requests before the orchestrator removes it from rotation) — see "Known operational limits" below for why that's unverified in this specific dev environment, and verify it for real in your target orchestrator (Kubernetes `preStop` + `terminationGracePeriodSeconds`, ECS deregistration delay, etc.) before relying on it.

## Rollback

- **Backend/Python services**: redeploy the previous container image / commit. Both are stateless processes; no in-memory state needs migrating back.
- **Schema**: Prisma does not auto-generate down-migrations. Roll back by writing and applying a new forward migration that reverses the change (e.g. drop the added column) — never `migrate reset` in production, it drops all data. Because `Email.address` and `Creator.websiteUrl` are unique constraints backing the duplicate-prevention guarantee, any rollback migration must confirm it doesn't drop a constraint that's live application logic depends on before applying it.
- **Redis**: purely a cache/queue (`docs/DATABASE.md` "Redis keys" table) — safe to flush in an emergency; the system degrades to slower/duplicate-risking behavior, not incorrect data, since Postgres unique constraints are the authoritative backstop (`apps/backend/src/routes/ingest.ts` catches the constraint violation and logs `store_conflict` rather than double-inserting).
- **Bad deploy causing errors**: `/ready` will report `not_ready` for the specific failing dependency — check `checks[].name`/`error` in its response before deciding what to roll back.

## Monitoring

- **`GET /metrics`** (Prometheus format, unversioned, no auth — do not expose publicly without a scrape-only network policy): see `monitoring/README.md` for the full metric reference, `monitoring/grafana-dashboard.json` for an importable dashboard (request rate/latency/errors, circuit breaker state, ingest funnel, cache hit ratio, Redis failures, DB query duration, process CPU/memory), and `monitoring/prometheus-alerts.yml` for ready-to-load alert rules covering all of the above.
- **Logs**: structured JSON, one line per request, correlated by `x-request-id` across all four processes (backend `pino`/`pino-http`, Python `apps/python/shared/request_logging.py`) — see `docs/ARCHITECTURE.md`. Secrets (`X-API-Key`, `Authorization`, `Cookie`) are redacted, not logged (`apps/backend/src/logger.ts`). Ship to your log aggregator of choice; nothing in-repo does this yet.
- **Health checks for your orchestrator**: liveness = `GET /health` (always 200 if the process is up), readiness = `GET /ready` (503 if Postgres, Redis, or any Python service is unreachable — do not route ingest traffic to an instance failing this).
- **Uptime monitoring**: not run from inside this repo — see `monitoring/README.md` "Uptime monitoring" for setting up an external prober (synthetic monitoring service or `blackbox_exporter`) against `/health` and `/ready`.
- **Slow-query alerts**: `db_query_duration_seconds{model,operation}` (Prisma query timing, `apps/backend/src/db.ts`) + `MakeAbleSlowDatabaseQueries` in `monitoring/prometheus-alerts.yml` — see `monitoring/README.md` "Slow-query alerting".

## Dependency management

- Backend production dependencies: `npm audit --omit=dev` is clean. The 20+ high-severity findings `npm audit` reports without `--omit=dev` are all in `jest`'s dev-only toolchain (`glob`/`minimatch`/`brace-expansion`), not shipped in `npm run build`'s output.
- Python services: `fastapi`/`starlette` were bumped (`fastapi==0.141.1`, `starlette==1.3.1` pinned explicitly since fastapi's own range doesn't force it) to clear several disclosed `starlette` CVEs found via `pip-audit` during this readiness pass; `pytest==9.1.1` similarly. All three services' test suites and a live smoke-test (`uvicorn` + `curl`) passed against the new versions.
- `.github/dependabot.yml` opens weekly update PRs for the backend (npm), each Python service (pip), and GitHub Actions itself — review and merge these regularly rather than letting dependencies drift for months between manual audits.
- Residual `pip`/`setuptools` CVEs `pip-audit` reports are in the venv/build toolchain itself, not a `requirements.txt` entry — not part of the deployed application; keep the base image/Python version current instead.

## RC2 benchmark: DATABASE_URL pooling verification

RC1's load test found `DATABASE_URL` on the direct connection (port 5432) crashes with `FATAL: max clients reached ... pool_size: 15` at 100 concurrent requests — a hard, shared-per-project ceiling. RC2 re-ran the same tests with `DATABASE_URL` switched to the pooled pgbouncer connection (port 6543). Same endpoint (`GET /api/v1/creators`), same tiers, live against the real Supabase/Upstash instances:

| Tier | Config | Errors | p50 latency | Throughput | Notes |
|---|---|---|---|---|---|
| 100 | RC1, direct (5432) | 33/2,731 `FATAL: max clients reached` (hard DB-level crash) | 338ms | ~273 req/s | Shared-project connection ceiling exhausted |
| 100 | RC2, pgbouncer (6543) | 0/677 | 1603ms | ~58 req/s | No crashes; higher latency (pgbouncer overhead + Prisma's 17-connection client-side pool) |
| 500 | RC2, pgbouncer (6543) | 0/~1,769 | 5284ms | ~59 req/s | Throughput flat vs. 100-tier — confirms the fixed-size pool, not raw concurrency, is now the limiting factor |
| 1000 | RC2, pgbouncer (6543) | 537/~2,000 client-side **timeouts** (not DB crashes) — `Timed out fetching a new connection from the connection pool (connection limit: 17)` | 5326ms | ~46 req/s | **The critical difference from RC1**: overload now fails as a contained, graceful Prisma-client timeout, never touching the shared database's hard limit |

**Conclusion**: pgbouncer trades throughput/latency (real, measured cost) for eliminating the shared-resource-crash risk (real, measured benefit) — at 1000 concurrent, RC1's failure mode could have destabilized every other application on that Supabase project; RC2's failure mode is fully contained inside this backend's own process. This is the correct trade for a shared production database. If throughput at high concurrency becomes a real requirement, the next lever is raising `?connection_limit=N` on `DATABASE_URL` (bounded by Supabase's pooler-side pool size for the plan) — not reverting to the direct connection.

Same tiers under normal production rate limiting (the actual deployed configuration, not a stress-test posture): 0 errors at all three tiers, 100–120 requests succeed per window as designed, rest correctly `429`. The rate limiter is the real first line of defense in production; the numbers above are what happens if that limiter is bypassed or misconfigured.

## Known operational limits (carry these into on-call runbooks)

- API key auth is flat/global (any valid key can access anything) — no per-tenant scoping/roles yet. See `docs/SECURITY.md` "Authentication".
- Rate limiting is both per-IP and per-API-key (`RATE_LIMIT_MAX`/`API_KEY_RATE_LIMIT_MAX`/`INGEST_RATE_LIMIT_MAX`), and fails open on a Redis outage (`apps/backend/src/middleware/rateLimit.ts`) — a sustained Redis outage means rate limiting is not enforced, not that traffic is blocked.
- `POST /api/v1/ingest/run` is synchronous per request — it walks every candidate URL from `search` sequentially. Large `niche` result sets will hold the HTTP connection open for the full duration; there is no job queue yet (`BullMQ` is in `PROJECT.md`'s target stack but not implemented).
- No SMTP/email-sending service exists — this is a discovery/storage slice only.
- **Graceful-shutdown OS-signal delivery is unverified on Windows dev sandboxes** — confirmed this session that Windows refuses graceful `taskkill` for a backgrounded Node process ("can only be terminated forcefully") and cross-process `SIGTERM`/`SIGINT` don't reliably invoke the JS handler either; this is a well-documented Node-on-Windows limitation, not an app defect. The shutdown *logic* itself (`httpServer.close()` + `Promise.all([prisma.$disconnect(), redis.quit()])` + 10s force-exit ceiling, `apps/backend/src/server.ts`) is straightforward and correct by code review, and Linux/Docker/Kubernetes (the actual deployment target) deliver `SIGTERM` natively and reliably. **Verify this with a real signal test in a Linux CI job or staging container before depending on it operationally** — it has not been conclusively proven end-to-end in any environment yet, only code-reviewed.
