# MakeAble — Creator Discovery Slice

This repo currently implements the **first vertical slice** of the MakeAble platform described in `PROJECT.md`: **Search → Extract → Validate → Store**, for discovering creators and their publicly listed business emails from official profile/website pages.

AI personalization, email sending, campaigns, and the frontend are **not implemented yet** — see `PROJECT.md` for the full intended platform and `docs/ARCHITECTURE.md` for what's built so far.

## Architecture

```
apps/backend      Node + TypeScript + Express + Prisma
                   owns Postgres + Redis, exposes the API, orchestrates the
                   search -> extract -> validate pipeline

apps/python/search      FastAPI service: finds candidate creator profile/website URLs
apps/python/extractor   FastAPI service: visits a URL, extracts email/social/bio
apps/python/validator   FastAPI service: syntax + MX + disposable-domain check
apps/python/shared      email_utils.py shared by extractor and validator
```

Full details: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`.

## Prerequisites

- Node.js 20+
- Python 3.11+
- A [Supabase](https://supabase.com) project (Postgres) and an [Upstash](https://upstash.com) Redis database — both have free tiers, no local containers needed

## Setup

```bash
cp .env.example .env
# Fill in DATABASE_URL / DIRECT_URL from Supabase and REDIS_URL from Upstash (see comments in .env.example)

# Backend
cd apps/backend
npm install
npx prisma migrate deploy   # applies the hand-authored initial migration -- see docs/DATABASE.md
npx prisma db seed          # optional: one sample creator for local testing
npm run dev

# Python services (each in its own terminal / venv)
cd apps/python/search      && pip install -r requirements.txt && uvicorn main:app --port 8001
cd apps/python/extractor   && pip install -r requirements.txt && uvicorn main:app --port 8002
cd apps/python/validator   && pip install -r requirements.txt && uvicorn main:app --port 8003
```

## Running the pipeline

All routes live under `/api/v1`. `/health`, `/ready`, and `/metrics` are unversioned.

```bash
curl -X POST http://localhost:4000/api/v1/ingest/run \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <any-unique-string>" \
  -d '{"niche": "couple vlog", "platform": "instagram"}'
```

This calls search → extractor → validator (cached, retried, and circuit-broken per service — see `docs/ARCHITECTURE.md`), checks the Redis duplicate cache, and writes validated creators to Postgres. Repeating the same `Idempotency-Key` returns the original result instead of re-running the pipeline. List stored creators:

```bash
curl http://localhost:4000/api/v1/creators?page=1
```

Operational endpoints:

```bash
curl http://localhost:4000/health    # liveness
curl http://localhost:4000/ready     # readiness: Postgres, Redis, all three Python services
curl http://localhost:4000/metrics   # Prometheus metrics
```

## Testing

See `docs/TESTING.md`. Quick version: `npm test` in `apps/backend` runs everything against `ioredis-mock` (no live Redis/Postgres required); real-cloud integration tests are opt-in via `RUN_INTEGRATION_TESTS=true` and never auto-load any `.env` file.

## Why the old scripts are gone

`main.py` and `test.py` used to brute-force search-engine queries and regex emails out of search-result *snippets* — functionally an email harvester, which `PROJECT.md` §3 explicitly forbids and §13 explicitly disallows. They've been replaced by the search/extractor split above, which only extracts emails from the actual official page content. See `docs/SECURITY.md` for more on this.
