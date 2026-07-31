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
| `bio` | nullable. Extracted by `apps/python/extractor` but discarded before this column existed (Sprint 3 migration `20260731000000_add_creator_bio_social_links`) -- existing rows ingested before that migration have no bio until re-ingested. Consumed by `apps/ai` for creator summaries. |
| `socialLinks` | `text[]`, default `{}`. Same migration/history as `bio`. |
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

## AI schema isolation (apps/ai, Sprint 3)

`apps/ai` owns 6 tables in a **separate Postgres schema** named `ai` (`CREATE SCHEMA ai`), inside the same physical Supabase database `apps/backend` uses -- not a separate database, not a separate Supabase project. This keeps the AI tables (and their own `_prisma_migrations` history) fully isolated from the backend's `public` schema without needing new infrastructure: two independent Prisma projects can't have their migration histories collide if they never share a schema.

Set via `?schema=ai` on `AI_DATABASE_URL`/`AI_DIRECT_URL` (`apps/ai/prisma/schema.prisma`) -- both otherwise point at the exact same host/pooler/credentials as the backend's `DATABASE_URL`/`DIRECT_URL` (pooled port `6543` for runtime, direct port `5432` for migrations -- same pgbouncer rule as `apps/backend`, see "Connection pooling" below).

`apps/ai` never queries `Creator`/`Email`/`ValidationResult` directly (no Prisma relation crosses the schema boundary) -- it fetches creator content over HTTP from `apps/backend`'s own `GET /api/v1/creators/:id`, preserving the "each service owns its own tables" boundary from `docs/ARCHITECTURE.md`.

| table | purpose |
|---|---|
| `prompt_templates` | one row per named prompt (e.g. `creator-summary`) |
| `prompt_versions` | one row per version of a template; `content`/`variables` mirror the file at `apps/ai/prompts/<name>/v<N>.md` (files are the source of truth, this table is the audit/version registry -- see `docs/API.md` "Provider adapters") |
| `ai_jobs` | one row per pipeline invocation (`/summary`, `/brand-fit`, `/draft`); `status`, `input`, `result`/`error`, timestamps |
| `ai_generations` | one row per individual LLM call within a job -- `model`, `provider`, `promptVersionId`, `latencyMs`, `promptTokens`/`completionTokens`/`totalTokens`, `estimatedCostUsd`, `usedFallback`, `createdAt` |
| `creator_summaries` | latest summary per creator (`creatorId` unique -- upserted, not accumulated; `ai_generations` is the historical record if that's ever needed) |
| `draft_emails` | saved drafts. `status` is `"draft"` \| `"approved"` \| `"rejected"` (human review workflow, `apps/admin`/Sprint 5 -- `reviewedBy`/`reviewedAt`/`updatedAt` columns added non-destructively) -- still advisory only, no SMTP/email client anywhere in `apps/ai`, and `apps/email` doesn't currently gate sending on this status |

## Email schema isolation (apps/email, Sprint 4)

Same pattern again: `apps/email` owns 6 tables in a third Postgres schema (`email`, set via `?schema=email` on `EMAIL_DATABASE_URL`/`EMAIL_DIRECT_URL`), same physical Supabase database, own isolated `_prisma_migrations` history. Now three services, three schemas (`public`/`ai`/`email`), one database -- see "AI schema isolation" above for why this scales cleanly (each service's migration history is independent by construction, not by convention).

`apps/email` never queries `apps/ai`'s or `apps/backend`'s tables directly -- it fetches draft content from `apps/ai`'s `GET /api/v1/ai/drafts/:id` and stores only `creatorId`/`draftEmailId` by value (no cross-schema Prisma relation), the same boundary `apps/ai` itself respects toward `apps/backend`.

| table | purpose |
|---|---|
| `sender_profiles` | a configured "From" identity + which provider adapter sends on its behalf (`mock`\|`smtp`\|`resend`\|`ses`\|`sendgrid`) + SPF/DKIM/DMARC verification flags |
| `campaigns` | one row per campaign; `status` is the state machine (`pending_review` -> `approved` -> `queued` -> `sending` -> `completed`, with a `paused` state reachable from `queued`/`sending` and back -- `apps/admin`/Sprint 5) -- see `docs/ARCHITECTURE.md` "Email delivery pipeline" for the guarded transitions |
| `campaign_recipients` | one row per (campaign, recipient email) -- `@@unique([campaignId, email])` enforces "one active send per recipient per campaign" at the database level, not just in application code. Indexed on `creatorId` (Sprint 5, additive) to support `GET /creators/:creatorId/campaign-history`. |
| `email_events` | the business-level status timeline per recipient (queued/sent/delivered/deferred/bounced/opened/clicked/replied/failed) |
| `email_provider_logs` | the raw provider request/response audit log per send attempt -- distinct from `email_events`; never stores provider API keys/secrets |
| `suppression_list` | global, cross-campaign; checked before every enqueue and again immediately before every send. Not one of the 5 tables literally named in the Sprint 4 spec, but required by its own "Respect suppression lists" rule -- same "add what the rules structurally require" precedent as `apps/backend`'s `bio`/`socialLinks` columns (Sprint 3). |

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

The same rule applies to `apps/ai`'s `AI_DATABASE_URL`/`AI_DIRECT_URL` and `apps/email`'s `EMAIL_DATABASE_URL`/`EMAIL_DIRECT_URL` (all three use the identical query-timing `$extends` pattern in their own `db.ts`) -- all three services share the same pool_size ceiling on the same Supabase project, since it's the same physical database. Every service getting this right is what makes the pgbouncer rule actually hold in practice, not just on paper -- now three services deep, not two, and the discipline still needs to hold for a fourth if one is ever added.

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
| `email:ratelimit:general:{ip}`, `email:ratelimit:apikey:{key}` | `apps/email`'s rate limiters, prefixed to avoid key collision with the backend's own (same Redis instance) | `RATE_LIMIT_WINDOW_MS` |
| `bull:email-send:*`, `bull:email-send-dlq:*` | BullMQ's own queue/job state (`apps/email`, Sprint 4) -- not managed by this app's code, BullMQ owns this keyspace entirely | per-job, BullMQ-managed |

**BullMQ's Redis connection requirement differs from every other Redis client in this repo**: it needs `maxRetriesPerRequest: null` (`apps/email/src/queue/connection.ts`), not the fail-fast `maxRetriesPerRequest: 2` used everywhere else (`docs/DATABASE.md` "Connection resilience" below) -- BullMQ relies on blocking Redis commands that must be allowed to wait, and the fail-fast setting breaks them. Two separate ioredis connections exist in `apps/email` for exactly this reason: one fail-fast (rate limiting, health checks), one for BullMQ.

`creator:email`/`creator:website` used to share `CACHE_TTL` with the unrelated search-result cache — after that TTL (1h) expired, an already-stored creator's URL/email would silently re-enter the full pipeline again (Postgres's unique constraint still blocked the actual duplicate row, but only after redoing all three downstream calls). Split into its own `DUPLICATE_TTL_SECONDS` so the fast-path cache window actually matches the "don't repeat expensive work for known creators" intent, independent of how long search results should stay cached.

## Memory policy (Upstash)

Set the Upstash database's eviction policy to `noeviction` (Upstash dashboard -> Database -> Details), not an `allkeys-*` LRU/LFU policy. Every key this app writes carries an explicit `EX` TTL and is designed to expire on its own schedule (see table above); an eviction policy would instead let Redis evict keys under memory pressure *before* their TTL, which for `creator:email`/`creator:website` means silently losing duplicate-prevention state early (Postgres still catches the actual duplicate, but the fast path degrades) and for `idempotency:lock:*` means a lock could vanish mid-request, allowing a concurrent duplicate pipeline run. `noeviction` instead rejects writes (and ioredis surfaces that as a command error, handled by each caller's own fail-open/fail-loud logic) rather than silently dropping keys.

## Cache invalidation

There is no explicit invalidation path today — every cache/dedup key relies entirely on TTL expiry (see table above), which is intentional for `search:*`/`validation:*` (stale-but-not-wrong is an acceptable trade for fewer downstream calls) but means a manually corrected `Creator`/`Email` row in Postgres (e.g. an operator deletes a bad row) will **not** be reflected in Redis until the corresponding `creator:email`/`creator:website` key's TTL expires — the deleted creator will still read as a duplicate and be skipped for up to `DUPLICATE_TTL_SECONDS`. If manual data correction becomes a routine operation, add an explicit `DEL` of the relevant keys to that runbook step (see `OPERATIONS.md`) rather than building a general invalidation mechanism for a case that doesn't come up otherwise.

## Connection resilience

`apps/backend/src/services/duplicateCheck.ts`'s `createRedisClient()` sets `maxRetriesPerRequest: 2` and `commandTimeout: 2000` — ioredis's default (up to 20 retries per command) was observed during verification to block every request touching Redis (including the rate limiter, which runs on every request) for 10+ seconds during an outage. ioredis itself still reconnects automatically in the background with its default backoff; these settings only bound how long a single in-flight command waits before the caller gets control back. Callers decide their own degradation: the rate limiter fails open (see "Rate limiting" in `docs/API.md`), the duplicate checker/idempotency service let the error propagate (an ingest run fails loudly with `502`/`500` rather than silently skipping duplicate checks).
