# Database

Postgres is the source of truth (`apps/backend/prisma/schema.prisma`). Redis is a cache in front of it, never authoritative.

## Tables (this slice)

### `Creator`
| column | notes |
|---|---|
| `id` | uuid PK |
| `handle` | unique per platform |
| `platform` | instagram / youtube / tiktok |
| `niche` | indexed, and composite-indexed with `platform` (the common `GET /creators` filter combination) |
| `websiteUrl` | indexed, unique when present |
| `instagram`, `youtube`, `tiktok` | indexed, nullable |
| `createdAt` | indexed (list endpoint orders by it) |
| `updatedAt` | |

### `Email`
| column | notes |
|---|---|
| `id` | uuid PK |
| `creatorId` | FK -> Creator |
| `address` | unique, indexed |
| `sourceUrl` | the actual page the email was extracted from (never a search snippet) |

### `ValidationResult`
| column | notes |
|---|---|
| `id` | uuid PK |
| `emailId` | FK -> Email |
| `isValid` | bool |
| `confidenceScore` | float 0-1 |
| `reasons` | string[] (e.g. `["mx_ok", "not_disposable"]` or `["mx_failed"]`) |
| `checkedAt` | indexed (supports a future "revalidate stale entries" query) |

Tables in PROJECT.md not yet needed (`campaigns`, `email_logs`) are deferred until the email-sending slice.

## Rules

- No `SELECT *` — Prisma queries always select explicit fields.
- All list endpoints paginate (`GET /creators?page=`).
- Unique constraints on `Email.address` and `Creator.websiteUrl` back up the Redis duplicate check — Redis is a fast-path, Postgres is the real guarantee.
- Migrations via `npx prisma migrate dev` / `deploy`; never hand-edit the DB schema.

## Migrations

`apps/backend/prisma/migrations/20260101000000_init/migration.sql` is the initial migration. It was generated with `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` (no live database connection required for that command) and verified to match `schema.prisma` exactly. It has **not** been applied against a real Supabase database in this environment — run `npx prisma migrate deploy` (or `migrate dev` for local iteration) against your real `DATABASE_URL`/`DIRECT_URL` before trusting it, then confirm with `npx prisma migrate status` that there's no drift.

## Seeding

`apps/backend/prisma/seed.ts` upserts one sample creator (from the original `creators.csv`) for local smoke-testing. Run with `npx prisma db seed` (wired via `package.json`'s `prisma.seed`), or `npm run seed`.

## Query performance

- `GET /api/v1/creators` is the only list endpoint: paginated (`skip`/`take`), filters on `niche`/`platform` (both indexed individually and as a composite `[niche, platform]` index matching this exact query shape), orders by `createdAt` (indexed). No `SELECT *` — Prisma's `select` always lists explicit fields (`apps/backend/src/routes/creators.ts`).
- The ingest pipeline's per-URL writes (`prisma.creator.create` with nested `emails`/`validationResult` creates, `apps/backend/src/routes/ingest.ts`) are single-row-graph inserts, not batch — fine at current volume (target: 200 emails/day per `PROJECT.md`), would need `createMany`/batching if volume grows by orders of magnitude.
- No N+1 patterns: the creators list uses one `findMany` with a nested `select` (Prisma issues a single query with a join, not one query per creator).

## Connection pooling

`apps/backend/src/db.ts` instantiates exactly one `PrismaClient` for the process lifetime (module-level singleton) — never create a `PrismaClient` per request. `DATABASE_URL` points at Supabase's pgbouncer pooler (port `6543`, `pgbouncer=true`), which is required because pgbouncer in transaction-pooling mode doesn't support Prisma's default prepared-statement behavior without that flag. `DIRECT_URL` (port `5432`, no pooling) is used only by `prisma migrate`, never at runtime.

For a single long-running Node process (this app's deployment model — not serverless), Prisma's default connection limit (`num_cpus * 2 + 1`) is appropriate; only override with `?connection_limit=N` on `DATABASE_URL` if running many backend instances against a Supabase plan with a low total connection cap, where `N × instance_count` must stay under that cap.

**Confirmed live during RC1 load testing**: pointing `DATABASE_URL` at the *direct* connection (port `5432`) instead of the pooled one reproduces real `FATAL: max clients reached in session mode - max clients are limited to pool_size: 15` errors at only 100 concurrent requests — that 15-connection ceiling is per-project, so it's shared with every other application using the same Supabase project, not exclusive to this backend. Always use the port-`6543` `?pgbouncer=true` URL for `DATABASE_URL` at runtime; reserve the direct port-`5432` URL for `DIRECT_URL` (migrations only). Getting this backwards is a real, reproducible production incident waiting to happen the first time traffic exceeds ~15 concurrent DB-touching requests, not a theoretical risk.

## Backup & recovery

- Supabase free/pro tiers include automated daily backups; paid tiers add Point-in-Time Recovery (PITR). Verify which tier the project is on and what RPO/RTO it implies **before** relying on it — this is a dashboard/billing setting, not something this repo controls or can verify from code.
- Confirm PITR/backup retention window covers your acceptable data-loss window; if not, either upgrade the Supabase plan or add an external `pg_dump` schedule.
- Recovery drill: restoring a Supabase backup does not require any application-side migration replay — the restored database already has the schema at backup time. After a restore, run `npx prisma migrate status` to confirm the restored schema still matches `prisma/schema.prisma` (it may not, if migrations landed after the backup was taken) before resuming traffic.
- This repo's migration is idempotent-safe to redeploy (`npx prisma migrate deploy` skips already-applied migrations), so a fresh environment stood up from a backup can safely run the normal deploy step again.

## Redis keys

| key | purpose | TTL |
|---|---|---|
| `creator:email:{email}` | duplicate check before insert | `DUPLICATE_TTL_SECONDS` (default 30d) |
| `creator:website:{domain}` | duplicate check before insert | `DUPLICATE_TTL_SECONDS` (default 30d) |
| `search:{platform}:{niche}` | cached search-service URL results | `CACHE_TTL` (default 1h) |
| `validation:{email}` | cached validator-service result | `VALIDATION_TTL` (default 24h) |
| `idempotency:lock:{key}` | in-flight marker for an `Idempotency-Key` | 60s |
| `idempotency:result:{key}` | stored `/ingest/run` response for replay | `IDEMPOTENCY_TTL_SECONDS` |
| `ratelimit:general:{ip}`, `ratelimit:ingest:{ip}` | fixed-window rate-limit counters | `RATE_LIMIT_WINDOW_MS` |

`creator:email`/`creator:website` used to share `CACHE_TTL` with the unrelated search-result cache — after that TTL (1h) expired, an already-stored creator's URL/email would silently re-enter the full pipeline again (Postgres's unique constraint still blocked the actual duplicate row, but only after redoing all three downstream calls). Split into its own `DUPLICATE_TTL_SECONDS` so the fast-path cache window actually matches the "don't repeat expensive work for known creators" intent, independent of how long search results should stay cached.

## Memory policy (Upstash)

Set the Upstash database's eviction policy to `noeviction` (Upstash dashboard -> Database -> Details), not an `allkeys-*` LRU/LFU policy. Every key this app writes carries an explicit `EX` TTL and is designed to expire on its own schedule (see table above); an eviction policy would instead let Redis evict keys under memory pressure *before* their TTL, which for `creator:email`/`creator:website` means silently losing duplicate-prevention state early (Postgres still catches the actual duplicate, but the fast path degrades) and for `idempotency:lock:*` means a lock could vanish mid-request, allowing a concurrent duplicate pipeline run. `noeviction` instead rejects writes (and ioredis surfaces that as a command error, handled by each caller's own fail-open/fail-loud logic) rather than silently dropping keys.

## Cache invalidation

There is no explicit invalidation path today — every cache/dedup key relies entirely on TTL expiry (see table above), which is intentional for `search:*`/`validation:*` (stale-but-not-wrong is an acceptable trade for fewer downstream calls) but means a manually corrected `Creator`/`Email` row in Postgres (e.g. an operator deletes a bad row) will **not** be reflected in Redis until the corresponding `creator:email`/`creator:website` key's TTL expires — the deleted creator will still read as a duplicate and be skipped for up to `DUPLICATE_TTL_SECONDS`. If manual data correction becomes a routine operation, add an explicit `DEL` of the relevant keys to that runbook step (see `OPERATIONS.md`) rather than building a general invalidation mechanism for a case that doesn't come up otherwise.

## Connection resilience

`apps/backend/src/services/duplicateCheck.ts`'s `createRedisClient()` sets `maxRetriesPerRequest: 2` and `commandTimeout: 2000` — ioredis's default (up to 20 retries per command) was observed during verification to block every request touching Redis (including the rate limiter, which runs on every request) for 10+ seconds during an outage. ioredis itself still reconnects automatically in the background with its default backoff; these settings only bound how long a single in-flight command waits before the caller gets control back. Callers decide their own degradation: the rate limiter fails open (see "Rate limiting" in `docs/API.md`), the duplicate checker/idempotency service let the error propagate (an ingest run fails loudly with `502`/`500` rather than silently skipping duplicate checks).
