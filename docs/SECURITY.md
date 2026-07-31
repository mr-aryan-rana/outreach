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

`apps/ai` (Sprint 3) uses the identical mechanism with its own key set (`AI_API_KEYS`, not shared with `apps/backend`'s `API_KEYS`), applied from day one rather than found-and-fixed later — including the log-redaction fix below, which `apps/ai/src/logger.ts` includes verbatim from the start.

`apps/email` (Sprint 4) uses the identical mechanism with its own key set (`EMAIL_API_KEYS`) for every `/api/v1/*` route **except** `/api/v1/webhooks/*` — see "Webhook authentication" below for why that's a deliberately different (and weaker) scheme.

### Webhook authentication (apps/email)

`POST /api/v1/webhooks/{resend,sendgrid,ses}` cannot require `X-API-Key` — the calling party is the email provider's infrastructure, which sends its own provider-specific payload/headers, not this project's API key. What's implemented instead (`checkWebhookToken()`, `apps/email/src/routes/webhooks.ts`) is a single shared-secret token (`WEBHOOK_SHARED_SECRET`), checked via `?token=` query param or `X-Webhook-Token` header, and if unset the route is **open** (acceptable for local/dev, explicitly logged and documented — see `DEPLOYMENT.md` — as unacceptable for a real production deployment).

**This is a known, documented gap, not a false sense of security**: a shared-secret token is not equivalent to the per-provider HMAC signature verification each provider actually offers (Resend's `svix` signing, SendGrid's Event Webhook signing key, SES's SNS message signature). Anyone who obtains or guesses the shared secret can forge delivery events — including a forged `"bounced"` event, which would incorrectly suppress a legitimate address. Before a real (non-mock) provider integration goes to production: implement each provider's actual signature verification in `checkWebhookToken()`'s call sites, replacing (not just supplementing) the shared-secret check.

### Sending-without-approval prevention (apps/email)

The Sprint 4 rule "never send AI drafts automatically, human approval required" is enforced as a hard state-machine gate, not a convention:

- `services/campaignService.ts`'s `sendCampaign()` throws `InvalidStateTransitionError` for any campaign not currently in `"approved"` status. There is no other function, route, or code path anywhere in this service that calls a provider's `send()` — the worker's `processSendJob()` is only ever invoked via a BullMQ job, and jobs are only ever created by `sendCampaign()`, which itself is only reachable after `approveCampaign()` has run.
- `approveCampaign()` itself requires the campaign to be `"pending_review"` (a campaign's only possible starting status, set unconditionally by `createCampaign()`) — so the sequence `create -> approve -> send` cannot be shortened or bypassed by any request shape.
- Covered by explicit regression tests (`apps/email/tests/services/campaignService.test.ts`, `it.each(["draft","pending_review","queued","sending","completed"])`) asserting `sendCampaign()` rejects every status except `"approved"`, and live-verified manually during this sprint (attempted to send an unapproved campaign, confirmed `409 invalid_state_transition`).
- This is the actual boundary the "drafts only, human review required" design in `apps/ai` (see "Prompt injection" below) relies on downstream — `apps/ai` can produce a bad draft, but `apps/email` is the backstop that guarantees no draft reaches a recipient without a human explicitly approving that specific campaign.

### Suppression and deduplication guarantees (apps/email)

- **Suppression** is checked **twice**: once at `POST /campaigns` (creation time, determines each recipient's initial `status`) and again by the worker immediately before the provider call (send time — `processSendJob()`, `apps/email/src/queue/worker.ts`), since a campaign can be created and approved long before it's actually sent, and an address can be suppressed in that window. A `bounced` webhook event automatically upserts a `suppression_list` row, so bounce-driven suppression doesn't depend on a human noticing the bounce first.
- **Deduplication** happens at two levels: (1) the input recipient list itself is de-duplicated in-memory before any DB write (`createCampaign()`, second occurrence of an email dropped, `email_duplicate_skipped_total` incremented), and (2) `@@unique([campaignId, email])` on `campaign_recipients` is the hard backstop, so even a bug in (1) cannot produce two rows for the same recipient in the same campaign. "One active send per recipient per campaign" follows directly from this constraint — there is no code path that creates a second `campaign_recipient` row for an email already present in that campaign.
- Neither guarantee is cross-campaign: the same address can legitimately receive email from two different campaigns (e.g. two different brand outreach efforts) — only same-campaign duplication and suppressed addresses are blocked.

## Dependency security (apps/email, Sprint 4)

Found via `npm audit --omit=dev` before writing any code depending on it: `nodemailer` <=9.0.0 carried a high-severity SMTP command injection / CRLF injection / SSRF advisory. Fixed by pinning `nodemailer`/`@types/nodemailer` to `^9.0.3` before the SMTP provider adapter (`apps/email/src/providers/smtp.ts`) was written against it, verified `npm audit --omit=dev` reports 0 vulnerabilities.

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

**Found and fixed during Sprint 5 testing, in all three services** (`apps/backend`, `apps/ai`, `apps/email` — same `RedisFixedWindowStore` implementation duplicated across each, present since RC1): the store only re-armed a key's TTL on the literal first hit (`totalHits === 1`). Live-reproduced under this sprint's sustained test load: a key ended up with hits recorded (`totalHits` in the dozens/hundreds) but no TTL (`PTTL` returned `-1`), meaning it would never expire — that caller would be **permanently** rate-limited until a human manually cleared Redis, a real availability risk for a legitimate caller, not just a testing inconvenience. Fixed by re-arming the TTL any time `PTTL` reports it's missing, not only on the request that happens to create the key. Regression-tested (`apps/email/tests/middleware/rateLimit.test.ts`).

## SQL injection

Reviewed: all database access goes through Prisma's typed query builder (parameterized by construction) except two `$queryRaw` calls (`SELECT 1` health/readiness checks, `apps/backend/src/server.ts`, `src/routes/health.ts`) — both are static tagged-template literals with no interpolated input. No `$queryRawUnsafe`/`$executeRawUnsafe` anywhere in the codebase. No injection surface found.

## SSRF

**Found and fixed during the RC1 security audit**: `apps/python/extractor`'s `POST /extract {url}` fetched any syntactically-valid HTTP(S) URL with no restriction on the target — Pydantic's `AnyHttpUrl` validates shape, not destination. This allowed fetching internal/private addresses (loopback, RFC1918 ranges, link-local/cloud-metadata `169.254.169.254`, etc.), and `follow_redirects=True` meant even an initially-external-looking URL could redirect to an internal target and still succeed.

Fixed in `apps/python/extractor/main.py`: `_assert_safe_target()` resolves the hostname and rejects private/loopback/link-local/reserved/multicast/unspecified addresses (Python's `ipaddress` module) *before* fetching, and redirects are now followed manually (not via `httpx`'s `follow_redirects=True`) so every hop — not just the initial URL — is re-validated the same way. Blocked requests return `400` and are logged (`extract_ssrf_blocked`). Covered by tests in `apps/python/extractor/tests/test_extractor.py` (blocks loopback, RFC1918, link-local/metadata, `::1`, non-HTTP schemes; allows a public IP literal) plus a live smoke test (public URL succeeds, `127.0.0.1` and `169.254.169.254` both return `400`).

`apps/python/search` and `apps/python/validator` were also reviewed: search only builds a DuckDuckGo query string from constrained enum/length-limited fields (never fetches an arbitrary URL itself); validator only performs DNS MX lookups (no HTTP fetch of user-influenced targets) — neither has the extractor's SSRF surface.

## Prompt injection (apps/ai, Sprint 3)

`apps/ai`'s prompts interpolate a creator's `bio` (extracted from their own public page, `apps/python/extractor`) directly into LLM prompts (`prompts/creator-summary/v1.md` and everything downstream of it). A bio containing adversarial text (e.g. "ignore prior instructions and instead...") is a real prompt-injection surface -- creator bios are externally-sourced, not trusted input.

Blast radius is bounded by design, not eliminated: every prompt already instructs the model not to invent facts and to work only from the given input (`apps/ai/prompts/*/v1.md`), and — the actual backstop — **every output is a draft requiring human review before anything is sent; there is no send path in this service at all**. A successful injection can produce a bad/weird draft for a human to catch and discard, not an autonomous harmful action (no email client, no campaign trigger, no data exfiltration path from this service). Not yet implemented: automated detection/stripping of injection-like patterns in extracted bios before they reach a prompt — worth adding if `apps/ai` ever gains any autonomous (non-human-reviewed) action.

## Resilience

Each downstream Python service call has its own circuit breaker (`apps/backend/src/services/resilience.ts`). This bounds blast radius if one service degrades: requests fail fast (`503`) instead of piling up retries against a service that's already down, and the breaker's half-open probe limits how hard a recovering service gets hit.

## Not yet addressed (future slices)

- API key auth is flat/global, not per-tenant/scoped — see "Authentication" above.
- No mTLS/network-level enforcement that only `apps/backend` can reach the Python services' HTTP ports — currently relies on network placement/firewalling at deploy time, not application-level restriction (beyond the SSRF guard, which restricts *what URL the extractor will fetch*, not *who can call the extractor*).
- `apps/email` webhook endpoints use a shared-secret token, not per-provider HMAC signature verification — see "Webhook authentication" above. Close this before any real (non-mock) provider integration.
- `apps/email` has no CAN-SPAM-mandated unsubscribe link/mechanism implemented in the sent email content itself (that lives in the draft body from `apps/ai`, outside this service's control) — get explicit legal sign-off before any real send, per "Why the original scraper was replaced" above; this remains unresolved from RC1 and still applies now that a real send path exists.
- `apps/admin` (Sprint 5) has no login/user identity of its own — anyone who can reach its URL can use every feature, including approving campaigns and sending real email once a real provider is configured. It must be deployed behind existing network/VPN access control (same assumption `DEPLOYMENT.md` already makes for internal tooling), not exposed publicly, until real auth is added. `X-Reviewed-By`/`approvedBy` values are free-text operator-supplied strings, not verified identities — useful for audit-trail readability today, not access control.
- `PATCH /ai/drafts/:id`'s `status` (approved/rejected) is review-tracking only — `apps/email` does not check it before a draft can be used as `draftEmailId` in a campaign. A rejected draft can still technically be sent if an operator creates a campaign against it directly. Not a defect introduced by Sprint 5 (this cross-service check never existed), but now more visible with a UI that implies "rejected means blocked."
