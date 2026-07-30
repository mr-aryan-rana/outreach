# Troubleshooting

Symptom-indexed. For routine procedures (rotation, rollback, scaling), see `OPERATIONS.md`.

## `GET /ready` returns 503

Check the `checks[]` array in the response body — it names exactly which dependency failed and why (`apps/backend/src/routes/health.ts`).

- **`postgres` failing**: `DATABASE_URL` wrong/expired, Supabase project paused (free tier pauses after inactivity), or connection limit exhausted. Verify with `npx prisma migrate status` from a machine with the same `DATABASE_URL`.
- **`redis` failing**: `REDIS_URL` wrong/expired, or Upstash database paused/deleted. Verify with `redis-cli -u "$REDIS_URL" PING`.
- **`search`/`extractor`/`validator` failing**: that Python service is down, or `SEARCH_SERVICE_URL`/`EXTRACTOR_SERVICE_URL`/`VALIDATOR_SERVICE_URL` points at the wrong address. Hit that service's own `GET /health` directly to isolate whether it's a networking/config issue (backend can't reach it) vs. the service itself being down.

## `POST /api/v1/ingest/run` returns `502`

A downstream Python service returned a non-2xx response or the HTTP call itself failed (not a circuit-breaker trip — that's `503`, see below). The error message includes which service and the underlying error (`apps/backend/src/routes/ingest.ts`). Check that service's logs for the same `x-request-id` (forwarded on every downstream call — `docs/ARCHITECTURE.md` "Correlation IDs").

## `POST /api/v1/ingest/run` returns `503`

A downstream service's circuit breaker is open — it failed `CIRCUIT_BREAKER_THRESHOLD` (default 5) consecutive calls and is now failing fast instead of hanging. See `OPERATIONS.md` "Respond to a downstream service circuit breaker stuck open". Not user-actionable via retry until the breaker's half-open probe (10s after opening) succeeds.

## `POST /api/v1/ingest/run` returns `409`

A request with the same `Idempotency-Key` is already in flight (`apps/backend/src/services/idempotency.ts`, 60s lock). Either wait for the first request to complete and retry with the same key (it'll then replay the stored result), or use a different key if this was meant to be a genuinely new request.

## Everything is slow / requests hang for ~10s then fail

Historically caused by a Redis outage combined with ioredis's default retry behavior (up to 20 retries per command before failing) — every request touches Redis via the rate limiter, so an outage stalled all traffic. This is already fixed (`maxRetriesPerRequest: 2`, `commandTimeout: 2000` in `apps/backend/src/services/duplicateCheck.ts::createRedisClient`) but is the first thing to suspect if this symptom reappears: check `redis_operation_failures_total{component="rate_limit"}` in `/metrics` and the `rate_limit_store_error` log line.

## A creator/email that should be new is being skipped as a duplicate

1. Check if it's actually already in Postgres: `select * from "Email" where address = '<email>'`. If yes, this is correct behavior, not a bug.
2. If it's *not* in Postgres but is still being skipped, the Redis `creator:email:*`/`creator:website:*` key is stale — likely left over from a manual Postgres deletion that didn't also clear Redis (see `OPERATIONS.md` "Manually correct a bad row"). Confirm with `redis-cli -u "$REDIS_URL" EXISTS "creator:email:<email>"` and `DEL` it if the corresponding Postgres row is genuinely gone.

## A duplicate row appears not to have been prevented

Should not happen — `Email.address` and `Creator.websiteUrl` are unique-constrained at the database level, which is the authoritative guarantee (Redis is only a fast-path). If you see two `Creator` rows for what looks like the same creator, check whether their `websiteUrl` values actually differ (e.g. `https://youtube.com/watch?v=abc` vs `?v=abc&t=5s` — different query strings are treated as different creators by design, since a YouTube video's ID lives in the query string — see the comment in `apps/backend/src/routes/ingest.ts` above the `handle` computation). This is expected behavior for distinct URLs, not a duplicate-prevention failure.

## `npx prisma migrate deploy` fails or reports drift

- Confirm `DATABASE_URL`/`DIRECT_URL` are both set and correct (`DIRECT_URL` — port `5432`, no pgbouncer — is required for migrations specifically).
- Run `npm run prisma:check` (offline, no live DB needed) to confirm `prisma/schema.prisma` and the committed migration SQL actually agree with each other before suspecting the target database.
- Never hand-edit `prisma/migrations/*/migration.sql` after it's been applied anywhere — author schema changes via `npx prisma migrate dev` and commit the newly generated migration file instead.

## CI fails on `npm run prisma:check`

Someone edited `apps/backend/prisma/schema.prisma` without generating/committing a corresponding migration. Run `npx prisma migrate dev` locally (needs a reachable Postgres, even a throwaway local one — this specific command, unlike `migrate deploy`/`migrate diff`, needs to actually connect) to generate the new migration file, commit it, and push again.

## A stray/unexpected `.env` appears in the repo with credentials that don't look like Supabase/Upstash

This has happened twice in this project's history (see `docs/SECURITY.md`, `docs/TESTING.md`). Do not use it. Do not let anything auto-load it (the integration test suite and CI deliberately never auto-load `.env` for this reason). Verify any `.env` actually contains MakeAble's own `DATABASE_URL`/`DIRECT_URL`/`REDIS_URL`/`SEARCH_SERVICE_URL`/etc. (per `.env.example`) before trusting it for anything, and flag the occurrence rather than silently working around it.

## Lint/typecheck/build fails in CI but works locally

Confirm local `node_modules` isn't stale relative to `package-lock.json` (`npm ci`, not `npm install`, is what CI uses — it's stricter about lockfile consistency). Run `npm ci && npm run lint && npx tsc --noEmit && npm run build` locally to reproduce exactly what CI does.
