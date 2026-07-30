# Security

## Why the original scraper was replaced

The original `main.py` searched DuckDuckGo with brute-force keyword/letter combinations and regexed emails directly out of search-result *snippets*. That is functionally an email harvester:

- It collected emails without visiting the source page, so there was no way to confirm the email was actually publicly listed as a business contact by its owner (vs. appearing incidentally in indexed text).
- It directly contradicted `PROJECT.md` §3 (Non-Goals: "Email harvester", "Private information collector") and §13 (Search Rules: extraction only from official websites/contact pages).
- `emails.json` / `creators.csv` — the harvested output — were committed to git with no `.gitignore`, putting scraped PII in version control history.

The new pipeline (`apps/python/search` -> `extractor` -> `validator`) only extracts an email after visiting the creator's own official page, and only stores it after MX/disposable validation. This does not eliminate legal risk around unsolicited outreach — it only ensures data is collected from a source the creator themselves published. **Before any email-sending slice is built, get explicit legal sign-off on CAN-SPAM / regional anti-spam compliance** (unsubscribe mechanism, sender identification, etc.) — that is out of scope for this slice and must not be assumed handled.

## Authentication

Every `/api/v1/*` route requires an `X-API-Key` header, checked with a timing-safe comparison against `API_KEYS` (comma-separated, supports rotation — `apps/backend/src/middleware/apiKeyAuth.ts`, `docs/API.md`). `/health`, `/ready`, `/metrics`, `/api-docs` remain unauthenticated (infra probes/scrapers/docs). Rate limiting applies both per-IP (before auth, bounds brute-force volume) and per-API-key (after auth, per-tenant quota) — see `docs/API.md`.

This is flat/global auth (any valid key can access anything) — there is no per-tenant scoping, role, or permission model yet. Sufficient for a small number of trusted internal/partner callers; revisit before onboarding many external tenants who shouldn't see each other's usage.

## Secrets

- All secrets/config via environment variables (`.env`, never committed — see `.gitignore`). `.env.example` documents required vars with placeholder values only.
- Never log `DATABASE_URL`, `REDIS_URL`, `API_KEYS`, or any future SMTP credentials. Structured request logs (`pino`/`pino-http` in `apps/backend`, JSON logging in each Python service) log request metadata (method, path, status, duration, request ID) only.
- **Found and fixed during the RC1 security audit**: `pino-http`'s default request serializer logs every incoming header verbatim, including `x-api-key` — confirmed by direct reproduction (see `apps/backend/src/logger.ts` `LOG_REDACT_PATHS`) that adding API key auth would have put every credential in plaintext in every request log line, contradicting the "never headers wholesale" policy above. Fixed with `pino`'s `redact` option (`x-api-key`, `authorization`, `cookie`, `set-cookie` → `"[Redacted]"`), covered by a regression test (`tests/hardening.test.ts` "never logs the X-API-Key header value").
- Secret scanning: repo scanned for common secret patterns (AWS keys, PEM private keys, `sk-`/`ghp_`/`xox`-prefixed tokens) — none found in tracked files. `.env` is gitignored and confirmed untracked; only `.env.example` (placeholders) is committed.
- **Integration tests never auto-load `.env` files.** `apps/backend/tests/integration/` requires the caller to explicitly export real credentials *and* set `RUN_INTEGRATION_TESTS=true` before it will run against a live database — see `docs/TESTING.md` for why this is a hard requirement, not a preference (a prior version of this suite silently loaded a stray `.env` and attempted a real write against an unrelated project's live Supabase instance — this has recurred more than once in this repo's history; always verify a `.env`'s contents actually belong to MakeAble before using it for anything).

## Data handling

- `emails.json` and `creators.csv` (pre-existing harvested data) are now git-ignored and untracked going forward. They still exist in prior commit history; purging history is a destructive rewrite and requires separate explicit approval before doing it.
- Validation results and confidence scores are stored so low-confidence/invalid emails can be excluded from any future outreach step.

## Rate limiting

`/api/v1/*` is rate-limited via a Redis-backed fixed-window store (shared across backend instances, not per-process), both per-IP and per-API-key — see `docs/API.md`. `POST /api/v1/ingest/run` has an additional, stricter per-key limit since it triggers the full pipeline and calls three downstream services per candidate URL.

## SQL injection

Reviewed: all database access goes through Prisma's typed query builder (parameterized by construction) except two `$queryRaw` calls (`SELECT 1` health/readiness checks, `apps/backend/src/server.ts`, `src/routes/health.ts`) — both are static tagged-template literals with no interpolated input. No `$queryRawUnsafe`/`$executeRawUnsafe` anywhere in the codebase. No injection surface found.

## SSRF

**Found and fixed during the RC1 security audit**: `apps/python/extractor`'s `POST /extract {url}` fetched any syntactically-valid HTTP(S) URL with no restriction on the target — Pydantic's `AnyHttpUrl` validates shape, not destination. This allowed fetching internal/private addresses (loopback, RFC1918 ranges, link-local/cloud-metadata `169.254.169.254`, etc.), and `follow_redirects=True` meant even an initially-external-looking URL could redirect to an internal target and still succeed.

Fixed in `apps/python/extractor/main.py`: `_assert_safe_target()` resolves the hostname and rejects private/loopback/link-local/reserved/multicast/unspecified addresses (Python's `ipaddress` module) *before* fetching, and redirects are now followed manually (not via `httpx`'s `follow_redirects=True`) so every hop — not just the initial URL — is re-validated the same way. Blocked requests return `400` and are logged (`extract_ssrf_blocked`). Covered by tests in `apps/python/extractor/tests/test_extractor.py` (blocks loopback, RFC1918, link-local/metadata, `::1`, non-HTTP schemes; allows a public IP literal) plus a live smoke test (public URL succeeds, `127.0.0.1` and `169.254.169.254` both return `400`).

`apps/python/search` and `apps/python/validator` were also reviewed: search only builds a DuckDuckGo query string from constrained enum/length-limited fields (never fetches an arbitrary URL itself); validator only performs DNS MX lookups (no HTTP fetch of user-influenced targets) — neither has the extractor's SSRF surface.

## Resilience

Each downstream Python service call has its own circuit breaker (`apps/backend/src/services/resilience.ts`). This bounds blast radius if one service degrades: requests fail fast (`503`) instead of piling up retries against a service that's already down, and the breaker's half-open probe limits how hard a recovering service gets hit.

## Not yet addressed (future slices)

- API key auth is flat/global, not per-tenant/scoped — see "Authentication" above.
- No mTLS/network-level enforcement that only `apps/backend` can reach the Python services' HTTP ports — currently relies on network placement/firewalling at deploy time, not application-level restriction (beyond the SSRF guard, which restricts *what URL the extractor will fetch*, not *who can call the extractor*).
