# MakeAble — Creator Discovery, AI Drafting, Email Delivery, and Admin Dashboard

This repo implements the **Search → Extract → Validate → Store** pipeline, **AI-generated outreach drafts** (creator summary, brand fit, subject/email/quality review), an **approval-gated email delivery platform** (Draft → Review → Approve → Send), and an **internal admin dashboard/CRM** from `PROJECT.md`. Per-tenant/scoped auth is the only major piece **not implemented yet**. See `PROJECT.md` for the full intended platform and `docs/ARCHITECTURE.md` for what's built so far.

## Architecture

```
apps/backend      Node + TypeScript + Express + Prisma
                   owns Postgres + Redis, exposes the API, orchestrates the
                   search -> extract -> validate pipeline

apps/ai            Node + TypeScript + Express + Prisma, standalone service
                   (own port, own Postgres schema) -- creator summary, brand
                   fit, email draft generation via OpenAI/Anthropic/Gemini.
                   Drafts only, never sends email. See docs/API.md "AI Service".

apps/email         Node + TypeScript + Express + Prisma + BullMQ, standalone
                   service (own port, own Postgres schema, two processes:
                   API + worker) -- campaign management, approval-gated
                   queueing, provider-adapter sending (mock/SMTP/Resend/SES/
                   SendGrid), delivery event tracking, suppression. Never
                   auto-sends a draft. See docs/API.md "Email Delivery Service".

apps/admin         Next.js 15 + React 19 internal dashboard/CRM. No database
                   of its own -- a client of the three services above, reached
                   only through its own server-side API proxy (browser never
                   holds a backend API key). See docs/API.md "Admin Dashboard".

apps/python/search      FastAPI service: finds candidate creator profile/website URLs
apps/python/extractor   FastAPI service: visits a URL, extracts email/social/bio
apps/python/validator   FastAPI service: syntax + MX + disposable-domain check
apps/python/shared      email_utils.py shared by extractor and validator
```

Full details: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `DEPLOYMENT.md`, `OPERATIONS.md`, `TROUBLESHOOTING.md`.

Interactive API docs: `GET /api-docs` (Swagger UI, served from `apps/backend/openapi.yaml`).

## Prerequisites

- Node.js 20+
- Python 3.11+
- A [Supabase](https://supabase.com) project (Postgres) and an [Upstash](https://upstash.com) Redis database — both have free tiers, no local containers needed

## Setup

```bash
cp .env.example .env
# Fill in DATABASE_URL / DIRECT_URL from Supabase and REDIS_URL from Upstash (see comments in .env.example)
#
# DATABASE_URL -> Supabase's pooled pgbouncer connection, port 6543, `?pgbouncer=true`.
#                 Used at runtime by the backend. Get it from Supabase dashboard ->
#                 Project Settings -> Database -> Connection string -> "Transaction" mode.
# DIRECT_URL   -> Supabase's direct connection, port 5432, no pgbouncer.
#                 Used ONLY by `prisma migrate`. Same dashboard page -> "Session" mode.
# Mixing these up is a real, confirmed-live incident, not a theoretical warning: pointing
# DATABASE_URL at the direct (5432) connection hits a hard `pool_size: 15` ceiling shared
# with every other app on the same Supabase project -- see docs/DATABASE.md "Connection
# pooling" and DEPLOYMENT.md "RC2 benchmark" for the reproduction.
# Also set API_KEYS (comma-separated, e.g. `openssl rand -hex 32`) -- every /api/v1/*
# request requires an X-API-Key header, see docs/API.md "Authentication".

# Backend
cd apps/backend
npm install
npx prisma migrate deploy   # applies the hand-authored initial migration -- see docs/DATABASE.md
npx prisma db seed          # optional: one sample creator for local testing
npm run lint                # eslint
npm test                    # jest, ioredis-mock -- no live services required
npm run dev

# Python services (each in its own terminal / venv)
cd apps/python/search      && pip install -r requirements.txt && uvicorn main:app --port 8001
cd apps/python/extractor   && pip install -r requirements.txt && uvicorn main:app --port 8002
cd apps/python/validator   && pip install -r requirements.txt && uvicorn main:app --port 8003

# AI service (optional -- only needed for /ai/* endpoints)
cd apps/ai
cp .env.example .env   # AI_DATABASE_URL/AI_DIRECT_URL: same Supabase project as the backend,
                        # `&schema=ai` isolates its tables -- see docs/DATABASE.md.
                        # At least one of OPENAI_API_KEY/ANTHROPIC_API_KEY/GEMINI_API_KEY,
                        # or set AI_PRIMARY_PROVIDER=mock for a zero-cost local/CI run.
npm install
npx prisma migrate deploy
npm run dev   # port 8004

# Email delivery service (optional -- only needed for campaign/sending endpoints)
cd apps/email
cp .env.example .env.local   # or .env -- EMAIL_DATABASE_URL/EMAIL_DIRECT_URL (?schema=email),
                              # AI_SERVICE_URL/AI_SERVICE_API_KEY, BACKEND_URL/BACKEND_API_KEY.
                              # EMAIL_PROVIDER-per-sender-profile defaults to "mock" -- zero cost,
                              # zero network, safe for local/CI. See docs/API.md "Email Delivery Service".
npm install
npx prisma migrate deploy
npm run dev            # API, port 8005 -- only enqueues, never sends
npm run worker          # separate process, required to actually send queued emails

# Admin dashboard (optional -- Next.js UI for everything above)
cd apps/admin
cp .env.example .env.local   # BACKEND_URL/BACKEND_API_KEY, AI_SERVICE_URL/AI_SERVICE_API_KEY,
                              # EMAIL_SERVICE_URL/EMAIL_SERVICE_API_KEY -- server-only, never
                              # sent to the browser. See docs/API.md "Admin Dashboard".
npm install
npm run dev   # port 3000 (or next available) -- http://localhost:<port>/dashboard
```

## Running the pipeline

All routes live under `/api/v1`. `/health`, `/ready`, and `/metrics` are unversioned.

```bash
curl -X POST http://localhost:4000/api/v1/ingest/run \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <one of your API_KEYS>" \
  -H "Idempotency-Key: <any-unique-string>" \
  -d '{"niche": "couple vlog", "platform": "instagram"}'
```

This calls search → extractor → validator (cached, retried, and circuit-broken per service — see `docs/ARCHITECTURE.md`), checks the Redis duplicate cache, and writes validated creators to Postgres. Repeating the same `Idempotency-Key` returns the original result instead of re-running the pipeline. List stored creators:

```bash
curl http://localhost:4000/api/v1/creators?page=1 -H "X-API-Key: <one of your API_KEYS>"
```

Operational endpoints:

```bash
curl http://localhost:4000/health    # liveness
curl http://localhost:4000/ready     # readiness: Postgres, Redis, all three Python services
curl http://localhost:4000/metrics   # Prometheus metrics
```

## Running the AI pipeline

```bash
curl -X POST http://localhost:8004/api/v1/ai/draft \
  -H "Content-Type: application/json" -H "X-API-Key: <one of your AI_API_KEYS>" \
  -d '{"creatorId": "<uuid from GET /api/v1/creators>", "brand": {"name": "Acme", "description": "Widgets."}}'
```

Runs the full pipeline (creator summary -> brand analysis -> creator analysis -> brand fit score -> subject -> email draft -> quality review -> save) and returns a saved draft — see `docs/API.md` "AI Service" for `/summary` and `/brand-fit` (partial-pipeline endpoints) and `GET /ai/jobs/:id`.

## Testing

See `docs/TESTING.md`. Quick version: `npm test` in `apps/backend`, `apps/ai`, and `apps/email` (each separately) runs everything against mocks (`ioredis-mock`, a deterministic zero-cost `MockProvider` for LLM/email-sending calls — no live Redis/Postgres/AI-provider/email-provider credentials required); real-cloud integration tests are opt-in via `RUN_INTEGRATION_TESTS=true` and never auto-load any `.env` file. `apps/admin` has its own `npm test` (Jest + React Testing Library, mocked API layer) and `npm run test:e2e` (Playwright, against the real running services with the `mock` email provider).

## CI

`.github/workflows/ci.yml` runs on every push/PR: backend lint + typecheck + test + build + a Prisma schema/migration drift check (`npm run prisma:check`, offline — no live database), and `pytest` for each of the three Python services. Nothing in CI touches real Supabase/Upstash; every job uses local placeholder credentials.

## Why the old scripts are gone

`main.py` and `test.py` used to brute-force search-engine queries and regex emails out of search-result *snippets* — functionally an email harvester, which `PROJECT.md` §3 explicitly forbids and §13 explicitly disallows. They've been replaced by the search/extractor split above, which only extracts emails from the actual official page content. See `docs/SECURITY.md` for more on this.
