# Task

Replace the ad-hoc email-harvesting script with the first real vertical slice of the MakeAble platform (search → extract → validate → store), backed by cloud Postgres/Redis instead of local containers.

## Summary

Built a Search/Extract/Validate/Store pipeline matching PROJECT.md's service split (stateless Python services + a Node backend owning all persistence), replacing `main.py`'s brute-force snippet scraping. Switched Postgres/Redis from local Docker to Supabase/Upstash.

## Current State

- `apps/python/search`, `apps/python/extractor`, `apps/python/validator` — FastAPI services, each with `requirements.txt` and pytest tests
- `apps/python/shared/email_utils.py` — shared, deduplicated email-cleaning logic
- `apps/backend` — Node/TS/Express/Prisma; Postgres schema (`Creator`/`Email`/`ValidationResult`), Redis duplicate cache, `POST /ingest/run` orchestrator, paginated `GET /creators`
- `docs/{ARCHITECTURE,DATABASE,API,TESTING,SECURITY}.md`, `README.md`, `.env.example`, `.gitignore`
- `main.py`/`test.py` removed; `emails.json`/`creators.csv` untracked going forward (not purged from prior git history)
- Postgres via Supabase (pooled `DATABASE_URL` + direct `DIRECT_URL` for migrations), Redis via Upstash (`rediss://`, TLS)

## Root Cause

The original script harvested emails from search-result *snippets* across brute-force keyword/letter query combinations — no source-page visit, no validation, no duplicate tracking. This directly violated PROJECT.md §3 (bans "email harvester") and §13 (requires extraction from official pages only), and had no persistence layer at all.

## Solution

Split responsibilities per PROJECT.md §7: Python services are stateless (search returns URLs only, extractor visits the real page, validator checks syntax/MX/disposable status) and never touch the database; the Node backend owns Postgres, Redis, and all business logic, and orchestrates the three calls per request.

## Files Changed

See "Current State" above — full list in the plan at commit time; no files were force-deleted from git history, only removed going forward (`git rm`) or untracked (`git rm --cached`).

## Breaking Changes

- `main.py` / `test.py` no longer exist — any external process invoking them directly will break.
- Local Docker Postgres/Redis is no longer assumed; `DATABASE_URL`/`DIRECT_URL`/`REDIS_URL` must point at real Supabase/Upstash instances.

## Performance Impact

Redis duplicate-check runs before each DB write to avoid redundant inserts; Postgres unique constraints on `Email.address` and `Creator.websiteUrl` are the authoritative backstop. No load testing done yet — this is a single-request-at-a-time pipeline, not yet queued/batched.

## Security Impact

- Emails are only ever extracted from the actual official page (not search snippets), and validated (MX + disposable-domain check) before storage — see `docs/SECURITY.md` for full reasoning.
- Secrets are env-var only, never logged; `.env` is gitignored.
- No auth on the API yet — this slice is not meant to be internet-facing.
- **Unrelated flag**: a `.env` file with live third-party secrets (unrelated to this project) and this `RESPONSE.md` template appeared in the working directory during a prior session, written by something other than this work — worth confirming what's writing into this directory.

## Testing Checklist

- [x] `npm test` (Jest/Supertest) — duplicate prevention, pagination, ingest happy/duplicate/invalid/service-down paths
- [x] `npx tsc --noEmit` clean
- [x] `pytest` in each Python service — search query/URL logic, extractor parsing, validator syntax/MX/disposable/confidence logic
- [x] Regression test added for a real bug found during verification (`clean_email` run-on-suffix truncation)
- [ ] Live end-to-end run against real Supabase/Upstash + real Instagram/YouTube/TikTok pages (not yet done — do this before relying on it)

## Rollback Plan

`main.py`/`test.py`/`emails.json`/`creators.csv` are recoverable from git history (`git log`, `git show <commit>:main.py`) since only `git rm`/`git rm --cached` was used, not a history rewrite. Reverting the new commit(s) restores the old script as the working state.

## Future Work

AI personalization service, email-sending/SMTP service (with CAN-SPAM compliance review first), campaigns, auth, Next.js frontend, BullMQ queue, rate limiting on the public API itself.
