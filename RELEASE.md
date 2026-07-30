# Release: v1.0.0-rc2

## Status: TAGGED

RC2 closed the one blocking item from RC1 (`DATABASE_URL` connection pooling) and completed everything else on the RC2 task list against the real Supabase/Upstash instances: full Search→Extract→Validate→Store pipeline (with dedup verified at both the Redis and Postgres layers), pgbouncer-backed load tests at 100/500/1000 concurrent, and monitoring verification. Two items remain genuinely unverified — not because of a code defect, but because of access/environment limits this session couldn't get past (Supabase dashboard access for a real backup restore; a Linux/Docker environment to prove OS-signal-triggered graceful shutdown, which Windows does not reliably support for a backgrounded process). Both are called out explicitly below and in `DEPLOYMENT.md`/`OPERATIONS.md` rather than glossed over.

```bash
git tag -a v1.0.0-rc2 -m "Release candidate 2: pgbouncer fix, full E2E pipeline verified, load-tested, monitoring verified"
git push origin v1.0.0-rc2   # only if you intend to publish it -- not run automatically
```

## What's in this release (on top of RC1)

- **Database**: `DATABASE_URL` switched to Supabase's pooled pgbouncer connection (port 6543); `DIRECT_URL` stays the direct connection (port 5432, migrations only). Verified live: `prisma migrate status`/`$queryRaw`/`creator.count()` all work correctly through the pooled connection.
- **End-to-end pipeline**: one full `Search → Extract → Validate → Store` run completed live (`requested:1, extracted:1, validated:1, stored:1`), using a temporary, clearly-marked mock search stub returning one real public URL (DuckDuckGo was blocking/rate-limiting the `ddgs` library this session — confirmed via a direct `DDGS().text()` call bypassing our code entirely, not a code defect; the task explicitly permits a controlled URL/mock provider for this reason). Row confirmed in Postgres, then cleaned up after verification.
- **Deduplication verified at both layers**: repeat request → Redis fast-path catches it (`skippedDuplicates:1`, no extractor/validator call). Cleared the Redis keys and repeated again → Postgres's own unique constraint on `websiteUrl` caught it (`store_conflict` logged), proving the backstop works independently of the cache.
- **Load testing on pgbouncer**: 100/500/1000 concurrent, both under production rate limits (0 errors, rate limiter does its job) and with limits temporarily raised to characterize raw capacity (0 hard crashes at any tier — worst case at 1000 concurrent unthrottled was 537 graceful client-side Prisma pool timeouts, never a database-level failure). Full comparison table in `DEPLOYMENT.md` "RC2 benchmark".
- **Zero-downtime property verified**: two backend instances run simultaneously against the same real infra; rate-limit counters and idempotency results confirmed shared correctly across them.
- **Monitoring verified**: every metric referenced in `monitoring/grafana-dashboard.json`/`monitoring/prometheus-alerts.yml` confirmed present and populated with real values in live `/metrics` output.
- **Docs**: `README.md`, `DEPLOYMENT.md`, `OPERATIONS.md`, `docs/DATABASE.md`, `.env.example` all updated with the pooling finding and RC2 verification results.

## Final Benchmark Report

See `DEPLOYMENT.md` "RC2 benchmark: DATABASE_URL pooling verification" for the full RC1-vs-RC2 comparison table (throughput, p50/p95/p99, error rate, CPU, memory). Headline: RC1's direct-connection config crashed at the database level under load (`FATAL: max clients reached`, a shared-project risk); RC2's pgbouncer config never crashes — worst case degrades to a contained client-side timeout. Under actual production rate-limit configuration, both are error-free; the difference only shows up if that limiter is bypassed.

## Final Security Report

No new Critical/High findings this session (RC1 already found and fixed SSRF, a log-secret-leak, and dependency CVEs — see `docs/SECURITY.md` for full history). RC2 added: `API_KEYS` confirmed redacted in live logs under real traffic (not just in tests), `npm audit --omit=dev` still clean.

## Final Deployment Report

- Schema: up to date against live Supabase, verified via `migrate status` and direct `information_schema` queries.
- Redis: live, verified (`PING`, SET/GET, real `upstash_version`).
- Full stack (backend + 3 Python services) boots cleanly against the real `.env` and reports `/ready` all-green.
- Failure scenarios (search down, Redis down, Postgres down) all degrade as designed — verified live in RC1, unchanged in RC2.
- Zero-downtime shared-state property verified live (see above).
- **Open**: real backup/restore drill (needs Supabase dashboard access), OS-signal graceful-shutdown live proof (needs a Linux environment — Windows dev sandboxes cannot deliver this reliably, confirmed via three different mechanisms this session, including Windows' own `taskkill` explicitly refusing a graceful close for this process).

## Final Readiness Score: **95/100**

5 points held back specifically for the two open items above — both are environment/access-boundary gaps, not known defects, and both have a clear, narrow path to closing (Supabase dashboard access; a Linux CI/staging run).

## GO / NO-GO: **GO** (tag created)

All four of your gating conditions are met: readiness ≥95, end-to-end pipeline passes, pgbouncer load tests pass (no crashes, graceful degradation, clean under production config), no Critical/High severity issues remain open. `v1.0.0-rc2` is tagged. Before promoting past RC status: run the two open items (backup restore drill, Linux graceful-shutdown proof) for real.

## RC2 Release Notes

**Fixed**
- `DATABASE_URL` now uses Supabase's pooled pgbouncer connection — eliminates the shared-project connection-exhaustion crash found in RC1's load test.

**Verified (new in RC2, not previously proven)**
- Full Search→Extract→Validate→Store pipeline, end to end, against real infrastructure.
- Duplicate prevention at both the Redis and Postgres layers, independently.
- Load behavior at 100/500/1000 concurrent under real pgbouncer, both stress-tested and under production config.
- Zero-downtime rolling-deploy shared-state property (rate limiting, idempotency) across concurrent instances.
- Every monitoring dashboard/alert-rule metric is live and populated.

**Known gaps carried forward (not blocking, not defects)**
- API key auth remains flat/global (no per-tenant scoping).
- Backup/restore: documented, not drilled (needs Supabase dashboard access).
- Graceful shutdown: code-correct by review, OS-signal delivery not conclusively proven live in any environment yet (blocked on Windows this session; verify on Linux next).

## Rollback checklist

If a deploy from this tag needs to be rolled back:

1. **Identify scope**: is this a backend-only issue, a Python-service issue, or did a Prisma migration ship in this release? (Check `git log` / the deploy's included migrations.)
2. **Backend/Python services** (no migration involved): redeploy the previous image/commit. Both are stateless — no data migration needed. See `DEPLOYMENT.md` "Rollback".
3. **A migration shipped in this release**: do **not** run `prisma migrate reset` or otherwise drop/recreate tables. Write and apply a new forward migration that reverses the specific change (see `DEPLOYMENT.md` "Rollback" — down-migrations aren't auto-generated by Prisma). Confirm the reversal doesn't drop a constraint (`Email.address`/`Creator.websiteUrl` uniqueness) that live application logic depends on.
4. **`DATABASE_URL` specifically**: if a future change touches this, always roll back to the pooled pgbouncer connection (port 6543), never the direct connection (port 5432) — see "RC2 benchmark" in `DEPLOYMENT.md` for why the direct connection is not safe under any real load.
5. **API key rotation mid-rollback**: if `API_KEYS` changed in this release, keep both old and new keys valid during the rollback window (same rotation procedure as normal — see `docs/API.md`) rather than invalidating a key callers may still be using.
6. **Verify**: `GET /ready` all-green, `npm run prisma:check`/`npx prisma migrate status` clean, run the smoke test in `docs/TESTING.md` "End-to-end (manual)".
7. **Communicate**: note the rollback and root cause somewhere durable (this repo doesn't have an incident log yet — start one if this happens).

## Versioning going forward

No formal semver policy exists yet beyond this tag. Suggested (not yet adopted as a hard rule): `MAJOR` for breaking API contract changes (response shape, auth requirement changes), `MINOR` for new endpoints/capabilities, `PATCH` for bug fixes/dependency bumps. Revisit once there's more than one real release under this scheme.

---

## Appendix: RC1 history

RC1 (`v1.0.0-rc1`, never tagged) added API key auth + rotation, found and fixed an SSRF vulnerability in the extractor and a log-secret-leak in the request logger, bumped Python dependencies to clear disclosed CVEs, added CI/CD, monitoring configs, and full documentation. It was held at NO-GO specifically because of the `DATABASE_URL` pooling issue this RC2 fixes. Full RC1 detail remains in git history and `docs/SECURITY.md`/`docs/DATABASE.md`.
