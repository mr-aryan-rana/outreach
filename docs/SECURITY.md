# Security

## Why the original scraper was replaced

The original `main.py` searched DuckDuckGo with brute-force keyword/letter combinations and regexed emails directly out of search-result *snippets*. That is functionally an email harvester:

- It collected emails without visiting the source page, so there was no way to confirm the email was actually publicly listed as a business contact by its owner (vs. appearing incidentally in indexed text).
- It directly contradicted `PROJECT.md` §3 (Non-Goals: "Email harvester", "Private information collector") and §13 (Search Rules: extraction only from official websites/contact pages).
- `emails.json` / `creators.csv` — the harvested output — were committed to git with no `.gitignore`, putting scraped PII in version control history.

The new pipeline (`apps/python/search` -> `extractor` -> `validator`) only extracts an email after visiting the creator's own official page, and only stores it after MX/disposable validation. This does not eliminate legal risk around unsolicited outreach — it only ensures data is collected from a source the creator themselves published. **Before any email-sending slice is built, get explicit legal sign-off on CAN-SPAM / regional anti-spam compliance** (unsubscribe mechanism, sender identification, etc.) — that is out of scope for this slice and must not be assumed handled.

## Secrets

- All secrets/config via environment variables (`.env`, never committed — see `.gitignore`). `.env.example` documents required vars with placeholder values only.
- Never log `DATABASE_URL`, `REDIS_URL`, or any future API keys/SMTP credentials. Structured request logs (`pino`/`pino-http` in `apps/backend`, JSON logging in each Python service) log request metadata (method, path, status, duration, request ID) only — never headers or bodies wholesale.
- **Integration tests never auto-load `.env` files.** `apps/backend/tests/integration/` requires the caller to explicitly export real credentials *and* set `RUN_INTEGRATION_TESTS=true` before it will run against a live database — see `docs/TESTING.md` for why this is a hard requirement, not a preference (a prior version of this suite silently loaded a stray `.env` and attempted a real write against an unrelated project's live Supabase instance).

## Data handling

- `emails.json` and `creators.csv` (pre-existing harvested data) are now git-ignored and untracked going forward. They still exist in prior commit history; purging history is a destructive rewrite and requires separate explicit approval before doing it.
- Validation results and confidence scores are stored so low-confidence/invalid emails can be excluded from any future outreach step.

## Rate limiting

`/api/v1/*` is rate-limited via a Redis-backed fixed-window store (shared across backend instances, not per-process) — see `docs/API.md`. `POST /api/v1/ingest/run` has an additional, stricter limit since it triggers the full pipeline and calls three downstream services per candidate URL.

## Resilience

Each downstream Python service call has its own circuit breaker (`apps/backend/src/services/resilience.ts`). This bounds blast radius if one service degrades: requests fail fast (`503`) instead of piling up retries against a service that's already down, and the breaker's half-open probe limits how hard a recovering service gets hit.

## Not yet addressed (future slices)

- No authentication/authorization on the API — this slice runs locally/internally only. Add auth before any externally reachable deployment.
- Rate limiting is per-IP; there's no API-key/tenant-based quota yet since there's no auth layer to hang it off of.
