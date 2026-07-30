# Testing

## Backend unit + e2e (`apps/backend`)

```bash
cd apps/backend
npm test
```

Jest + Supertest, `ioredis-mock` standing in for Redis (no live dependency needed). Covers:
- duplicate-prevention (`tests/duplicateCheck.test.ts`)
- pagination + query validation (`tests/creators.test.ts`)
- ingest pipeline: happy path, duplicate skip, failed validation, service-down (`502`), idempotent replay (`tests/ingest.test.ts`)
- e2e across the real Express app stack: versioned routes, unversioned `/health`/`/ready`/`/metrics`, rate-limit headers, idempotency replay end-to-end (`tests/e2e/ingestFlow.test.ts`)

## Backend integration tests (real Supabase/Upstash)

```bash
cd apps/backend
RUN_INTEGRATION_TESTS=true DATABASE_URL=... DIRECT_URL=... REDIS_URL=... npm run test:integration
```

`tests/integration/` hits a **real** Postgres/Redis instance and is opt-in on purpose:
- `RUN_INTEGRATION_TESTS=true` must be set explicitly, in addition to a real-looking `DATABASE_URL`/`REDIS_URL`
- there is **no automatic `.env` loading** in this suite — export the variables yourself in the shell you run it from

This is deliberately strict: an earlier version of this suite auto-loaded whatever `.env` happened to be sitting in the repo directory and, in this environment, that turned out to be an unrelated project's live Supabase/Upstash credentials — the suite then attempted a real write against a database it had no business touching. Never reintroduce implicit env-file loading here; require the caller to opt in explicitly.

Without the opt-in, both integration test files self-skip with a log line explaining why — the standalone `npm test` run and CI never depend on real cloud credentials.

## Python services

Each service has its own tests, run independently:

```bash
cd apps/python/search      && pytest
cd apps/python/extractor   && pytest
cd apps/python/validator   && pytest
```

- `search`: query construction, URL filtering
- `extractor`: email/social extraction against fixture HTML (no live network calls in unit tests)
- `validator`: `email_utils.clean_email` edge cases, MX check with DNS mocked, disposable-domain detection, confidence scoring
- `validator`: request-ID logging middleware (`test_request_logging.py`) — request ID generation, echoing an incoming ID back

## End-to-end (manual, for this slice)

1. Ensure `.env` has real Supabase (`DATABASE_URL`/`DIRECT_URL`) and Upstash (`REDIS_URL`) values
2. `npx prisma migrate deploy` (in `apps/backend`) — applies the hand-authored initial migration; this has not yet been run against a real Supabase instance in this environment, so treat it as unverified until you do
3. `npx prisma db seed` for sample data
4. Start all three Python services and the backend
5. `POST /api/v1/ingest/run` with a small niche, with and without an `Idempotency-Key` header
6. Confirm: re-running the same request does not duplicate rows in Postgres, a repeated `Idempotency-Key` returns the cached result without re-invoking the Python services, and every stored email's `sourceUrl` is a real page (not a search snippet)
7. Hit `/ready` and `/metrics` and confirm they report real dependency status / real counters

Note: since Postgres/Redis are cloud-hosted (not local containers), tests and manual runs hit real network services — Supabase/Upstash free tiers are fine for dev, but be mindful of connection limits when running the test suite repeatedly.

There is no CI pipeline yet — add one when the project moves past this slice.
