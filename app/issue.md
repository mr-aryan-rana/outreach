# Issue Log

Generated from running `test_proxy_ddgs.py` plus a fresh pass over `app/` after the
rate-limiting/concurrency work and Telegram removal. Severity: **Critical** (breaks
core functionality or causes data/quota integrity loss) / **High** / **Medium** / **Low**.

> **Status: all items below fixed and verified against the live app** (real Supabase
> Postgres + Upstash Redis, not mocks). Summary of what changed, by section:
>
> - **§1** `test_proxy_ddgs.py` deleted (stale, imported a removed dependency).
> - **§2 Critical** `sender.py`/`locks.py`/`redis_core.py`: all Redis calls now wrapped
>   in `try/except redis.exceptions.RedisError` with an explicit fail-closed (send
>   quota) / fail-open (search lock) policy per call site, plus a 2s connect/socket
>   timeout so a Redis outage surfaces in ~2s instead of a long OS-level hang. Verified
>   live: app boots, sends refuse cleanly, and searches proceed with a logged warning
>   when Redis is unreachable.
> - **§3 High** `mailer/core.py`: `send_mass_emails` (the unthrottled bulk-send bypass)
>   deleted; `send_email` now distinguishes `SMTPAuthenticationError` /
>   `SMTPRecipientsRefused` / `SMTPResponseException` (Gmail throttling/quota) /
>   transient `SMTPException`/`OSError` instead of one bare `except Exception`.
> - **§5 High** No dashboard auth: added `app/utils/auth.py` (HTTP Basic, opt-in via
>   `DASHBOARD_USER`/`DASHBOARD_PASSWORD` in `.env`, logs a startup warning if unset).
>   Wired onto both the `/dashboard` and `/api` routers. Verified live: no creds → 401,
>   wrong creds → 401, correct creds → 200, `/health` stays open.
> - **§5/§6 Medium** N+1 queries in `emails_list`, `campaigns_page`, and `export.py`
>   fixed via `joinedload`/`selectinload`; `export.py`'s unbounded query now capped
>   (`DEFAULT_EXPORT_LIMIT = 10_000`). Verified live against real data: `/dashboard/emails`
>   and `/dashboard/campaigns` both return 200 with no errors.
> - **§4 Low** `DISPOSABLE_DOMAINS` now sourced from the `disposable-email-domains`
>   package (8,197 maintained domains vs. 6 hardcoded); `KNOWN_TLDS` now the full IANA
>   TLD registry (1,438 entries, bundled at `app/extractor/data/tlds.txt`) vs. 15
>   hardcoded. Verified: previously-mistrimmed `.ai`/`.xyz` emails now clean correctly.
> - **§5 Low** `add_email` now runs the real `is_valid_email` check before inserting.
> - **§7 Low** Scheduler cron time now `SCHEDULER_SEND_HOUR`/`SCHEDULER_SEND_MINUTE`
>   settings instead of hardcoded `hour=9, minute=0`.
> - **§8 Low** `requirements.txt` pinned to exact installed/tested versions;
>   29 root-level experiment scripts/HTML dumps moved to `experiments/` (git history
>   preserved via `git mv` for the 20 tracked `.py` files) with a README explaining
>   what they are.
>
> Full end-to-end verification: booted the real FastAPI app against live Supabase
> Postgres + Upstash Redis, confirmed startup, `/health`, auth (all 3 cases), and both
> N+1-affected pages all work correctly with no errors in the logs.

---

## 1. `test_proxy_ddgs.py` — ran it, here's what happened

```
Getting proxy...
Failed proxy: There are no working proxies at this time.
No proxy to test.
```
Exit code 0, no crash.

- **[Low] Confirms the FreeProxy removal decision was correct.** This is the exact
  failure mode `_get_new_proxy()` used to hit silently in `creator_search.py` before
  it was removed — free-proxy lists have essentially no live entries right now. Nothing
  to fix; this script is empirical evidence the earlier change was right.
- **[Low] Stale/orphaned script.** `test_proxy_ddgs.py` (repo root of `app/`) imports
  `fp.fp.FreeProxy`, a dependency that was intentionally removed from
  `requirements.txt` when `creator_search.py` was hardened. The package is still
  installed in this environment (leftover from before), which is why the script ran
  at all — on a clean install (`pip install -r requirements.txt`) this script would
  fail with `ModuleNotFoundError`. Either delete it or move it out of `app/` alongside
  the other root-level experiment scripts (see §5) — it doesn't test anything the app
  still uses.

---

## 2. Critical — Redis is now a hard dependency with zero error handling

This is a regression introduced by the rate-limiting fix itself, worth flagging
honestly. Before that work, Redis was configured but 100% unused (dead code) — the
app worked fine with no Redis running. Now `sender.py` (send-quota counter) and
`locks.py` (search lock) call `redis_client` directly with no try/except anywhere.

Verified directly:
```python
redis_client.get('x')  # against an unreachable Redis
# -> ConnectionError: Error 10061 connecting to localhost:65530.
#    No connection could be made because the target machine actively refused it.
```

Concrete impact:
- **App fails to start entirely** if Redis is unreachable: `main.py`'s `lifespan()`
  calls `sender.sync_send_counter_from_db()` before `yield`, which calls
  `redis_client.get(...)` — an unhandled `ConnectionError` here crashes uvicorn
  startup. Previously the app had no Redis dependency at boot at all.
- **Every send attempt 500s** if Redis drops mid-run: `sender._reserve_send_slot()` /
  `_release_send_slot()` (`services/sender.py:34-52`) have no error handling around
  `redis_client.incr/expire/decr`.
- **Every search attempt 500s** the same way: `locks.acquire_search_lock()`
  (`services/locks.py:22-24`) has no error handling around `redis_client.lock(...)`.

Fix needed: decide a fail-open vs fail-closed policy and implement it explicitly —
e.g. wrap the Redis calls in `try/except redis.exceptions.RedisError`, log a warning,
and either (a) fail closed for the send-quota reservation (reject the send — safer,
since the whole point was quota correctness) or (b) fail open for the search lock
(allow the search through with a logged warning — losing the lock is a soft
degradation, not a data-integrity issue, unlike the send counter). Also wrap the
startup reconciliation call in `main.py` so a Redis outage doesn't prevent the whole
app from booting.

---

## 3. `app/mailer/core.py`

- **[High] `send_mass_emails` (lines 22-44) is dead, unwired, and dangerous if ever
  called.** No route/service in `app/` invokes it (confirmed via grep — the only
  caller was `run_automation.py` at repo root, outside `app/`). It sends to every
  address in one SMTP session with **zero delay between sends** — if it's ever wired
  up (or copy-pasted as a starting point for something else), it bypasses every rate
  limit this app has (`EMAIL_SEND_DELAY_MIN/MAX_SEC`, the Redis quota reservation,
  everything). Recommend deleting it — `send_campaign`/`send_single` in `sender.py`
  already cover the real send paths correctly.
- **[Medium] `print(...)` instead of `logger`** (line 40, inside `send_mass_emails`) —
  bypasses log level control and isn't captured by the app's structured logging.
  Moot if the function above is deleted.
- **[Medium] Bare `except Exception` in both functions** (lines 19, 43) collapses
  Gmail auth failures, quota/rate-limit rejections, and transient network errors into
  one generic string. Callers (`sender.py`) can't distinguish "Gmail is throttling us"
  from "bad address" or "network blip," so nothing can react differently (e.g. back
  off harder on a real Gmail-side rate-limit signal vs. just logging and moving on).
- **[Low] New SMTP connection + login per `send_email()` call.** `send_single` opens
  a fresh connection for every one-off manual send from the dashboard. Not a problem
  at current volume (200/day cap), but worth knowing if volume ever grows — connection
  reuse would need a pool or a session-scoped SMTP client.

---

## 4. `app/validator/core.py` and `app/extractor/core.py`

- **[Low] `DISPOSABLE_DOMAINS`** (`extractor/core.py:13-16`) is a hardcoded 6-domain
  set. Trivially bypassed by any disposable-email provider not on the list (there are
  hundreds). Fine as a cheap first filter, not a real control — if disposable-address
  volume becomes a real problem, this should point at a maintained external list
  instead of a static set in source.
- **[Low] `KNOWN_TLDS`** (`extractor/core.py:18-21`) is a hardcoded ~17-TLD allowlist
  used to trim trailing sentence text off a matched email
  (`emily@gmail.com.Watch her videos` → `emily@gmail.com`). A legitimate email on a
  TLD not in this list (`.ai`, `.xyz`, `.online`, plenty of ccTLDs) either won't get
  trimmed correctly or, depending on what follows it in the snippet, could be silently
  mangled. Low volume impact given the target platforms/regions, but worth knowing as
  a source of quiet false negatives.
- **[Informational] MX/deliverability check confirmed MX-record-only, not SMTP-level**
  (`validator/core.py:23`, `email-validator==2.3.0`) — already throttled via
  `VALIDATION_DELAY_MIN/MAX_SEC` in the rate-limiting work. No new issue, just
  re-confirming this stays accurate after later changes.

---

## 5. `app/api/dashboard.py`

- **[High] No authentication on any dashboard route.** Every POST endpoint
  (`/orchestrator/start`, `/send`, `/emails/add`, `/search`, `/search-target`,
  `/validate`, `/campaigns`) is open to anyone who can reach the app. If this is ever
  exposed beyond localhost (a tunnel, a public deploy, port-forwarding), anyone can
  trigger mass sends, drain the daily quota, or kick off search runs. Not part of the
  rate-limiting work's scope, but worth a deliberate decision (even a single shared
  bearer token / basic auth in front of `/dashboard` would close most of this).
- **[Medium] N+1 query pattern in `emails_list`** (lines ~196-210) — for each of up to
  500 rows, accesses `email.creator` and iterates `email.email_logs` with no eager
  loading (`select(Email)` has no `.options(joinedload(...))`). Likely 500-1000 extra
  round trips per page load unless the SQLAlchemy relationship default happens to be
  eager (not configured that way in `models.py`).
- **[Medium] Same N+1 pattern in `campaigns_page`** (lines ~221-224) —
  `c.email_logs` iterated per campaign without eager loading.
- **[Low] `add_email` has no format validation** (line ~142) — a manually-added
  address is inserted as `Email(address=address, is_valid=False)` with only
  `.strip()` applied. It'll get caught later by `validate_pending`, but nothing stops
  garbage from sitting in the table as `is_valid=False, is_approved=False` indefinitely
  with no validation record until someone runs `/validate`.

---

## 6. `app/services/export.py`

- **[Medium] Unbounded query** (line 15: `select(Email).order_by(...)` with no
  `.limit()`) — loads every email row into memory then serializes to JSON. Directly
  contradicts the "scale to millions of creators" goal in `PROJECT.md`; fine at
  current volume, will not fine at scale.
- **[Low] Same N+1 iteration pattern** as `dashboard.emails_list` (accessing
  `.creator`, `.email_logs`, `.validations` per row with no eager loading), compounding
  with the point above once the table is large.

---

## 7. `app/scheduler/jobs.py`

- **[Resolved by earlier work, noting for completeness]** The daily cron
  (`_daily_send_job`, 09:00 UTC) calling `sender.send_campaign()` used to be able to
  race with the dashboard/orchestrator's own sends and jointly exceed
  `EMAIL_DAILY_LIMIT` (TOCTOU on a DB COUNT). This is now closed by the Redis atomic
  `INCR` reservation added to `sender.py` — flagging here only so it's clear this
  file was re-checked and the fix still covers it correctly (no lock/coordination
  logic needed in `jobs.py` itself, since the fix lives in the shared
  `_reserve_send_slot()` path both callers go through).
- **[Low] Hardcoded schedule time** (`hour=9, minute=0`, line 26) — not exposed via
  `settings`, requires a code change to adjust.

---

## 8. Repo hygiene — root-level experiment files

29 files at the repo root (`d:\Shivam\Outreach\`, outside `app/`) are one-off scraper
experiments/diagnostics from evaluating alternatives to the DDG search: `ask_test.html`,
`bing_test.html`, `ddg_lite.html`, `scraper_api_*.html`, `yahoo_test.html`,
`fetch_30_real_emails.py`, `playwright_fetch_tiktok.py`, `playwright_google_tiktok.py`,
`run_automation.py`, `run_full_test.py`, `run_google_scraper.py`, `run_social_scraper.py`,
`run_ytdlp_scraper.py`, `streamlit_app.py`, `migrate_json_to_db.py`, and 11 `test_*.py`
probes. None are imported by `app/`, none are covered by `app/requirements.txt` (several
need `playwright`, `yt-dlp`, or `googlesearch-python`, none of which are pinned
anywhere). Not urgent, but this is enough accumulated clutter that it's easy to
mistake one of these for live code — worth a decision on whether to keep them (in a
clearly-labeled `experiments/` folder) or delete them now that `creator_search.py` has
been hardened.

- **[Low]** `requirements.txt` has no version pins at all (`fastapi`, not
  `fastapi==0.141.1`). Fine for a single-developer local app, but means a fresh
  `pip install` on a new machine could pull a breaking future release of any
  dependency with zero warning.

---

## Summary by severity

| Severity | Count | Items | Status |
|---|---|---|---|
| Critical | 1 | Redis hard dependency, no error handling (app-crashing, send/search-breaking) | **Fixed** |
| High | 2 | `send_mass_emails` dead/dangerous code path; no dashboard auth | **Fixed** |
| Medium | 5 | Bare excepts in mailer; N+1 in `emails_list`/`campaigns_page`/`export.py`; unbounded export query | **Fixed** |
| Low | 8 | Disposable-domain/TLD hardcoded lists; SMTP connection reuse; `add_email` validation gap; hardcoded cron time; unpinned requirements; stale test script; root-level clutter | 7/8 **Fixed** |

**Remaining, not fixed:** SMTP connection reuse (§3, last bullet) -- `send_single`
still opens a new connection per manual send. Left as-is: real cost only shows up at
send volumes well beyond the 200/day cap this app targets, and pooling would be the
one change here that touches the actual send path's connection lifecycle rather than
being a contained, low-risk fix -- worth a deliberate look later rather than folding
into this pass.
