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

## Redis keys

| key | purpose | TTL |
|---|---|---|
| `creator:email:{email}` | duplicate check before insert | `CACHE_TTL` |
| `creator:website:{domain}` | duplicate check before insert | `CACHE_TTL` |
| `search:{platform}:{niche}` | cached search-service URL results | `CACHE_TTL` |
| `validation:{email}` | cached validator-service result | `VALIDATION_TTL` |
| `idempotency:lock:{key}` | in-flight marker for an `Idempotency-Key` | 60s |
| `idempotency:result:{key}` | stored `/ingest/run` response for replay | `IDEMPOTENCY_TTL_SECONDS` |
| `ratelimit:general:{ip}`, `ratelimit:ingest:{ip}` | fixed-window rate-limit counters | `RATE_LIMIT_WINDOW_MS` |
