# Operations

Day-2 runbook for `apps/backend` + the three Python services. For first deploy, see `DEPLOYMENT.md`. For diagnosing a specific symptom, see `TROUBLESHOOTING.md`.

## Daily / routine checks

- `GET /ready` on the backend — if any check is `false`, see `TROUBLESHOOTING.md` for that dependency.
- `GET /metrics` — watch `circuit_breaker_state{service}` (should be `0` closed for all three services under normal operation) and the `ingest_stage_total{stage="requested"}` vs `{stage="stored"}` ratio (a collapsing ratio means the pipeline is failing most candidates somewhere before storage).
- Dependabot PRs (`.github/dependabot.yml`, weekly) for the backend and each Python service — review and merge; don't let them pile up.
- **Monitoring verified (RC2)**: every metric referenced in `monitoring/grafana-dashboard.json` and `monitoring/prometheus-alerts.yml` was confirmed live and populated against the real deployment during RC2 verification — `circuit_breaker_state`, `db_query_duration_seconds`, `ingest_stage_total`, `cache_result_total`, `redis_operation_failures_total`, `process_resident_memory_bytes`, `process_cpu_seconds_total` all present with real values in `/metrics` output.

## Common runbook actions

### Rotate a credential (Supabase password, Upstash token)

1. Generate the new credential in the Supabase/Upstash dashboard.
2. Update `DATABASE_URL`/`DIRECT_URL`/`REDIS_URL` in the deployment environment (secret manager / platform env config — never in a committed file).
3. Restart the backend (`SIGTERM`, graceful drain — see `DEPLOYMENT.md` "Known operational limits" for the current verification status of that drain). Prisma and ioredis both pick up the new connection string on process start; there is no live credential-reload path, a restart is required.
4. Confirm `GET /ready` reports the relevant dependency `ok: true` post-restart before considering the rotation complete.
5. Revoke the old credential only after confirming the new one is live everywhere it's needed (don't revoke-then-verify).

### Manually correct a bad `Creator`/`Email` row in Postgres

Because Redis duplicate-prevention keys are TTL-only with no explicit invalidation path (`docs/DATABASE.md` "Cache invalidation"), deleting a row directly in Postgres does **not** clear its `creator:email:{email}` / `creator:website:{domain}` Redis key. Until that key's TTL (`DUPLICATE_TTL_SECONDS`, default 30 days) expires, the pipeline will keep treating that email/URL as already-seen and skip it — even though the Postgres row is gone.

1. Delete/correct the row(s) in Postgres.
2. Also delete the corresponding Redis key(s):
   ```bash
   redis-cli -u "$REDIS_URL" DEL "creator:email:<email lowercased>"
   redis-cli -u "$REDIS_URL" DEL "creator:website:<hostname><pathname, no trailing slash>"
   ```
   (see `apps/backend/src/services/duplicateCheck.ts` for the exact key-normalization rules if unsure).
3. Skip step 2 only if you *want* that email/URL to keep being treated as already-processed.

### Recover from a full Redis flush/outage

Safe by design: Redis is a cache/dedup fast-path, Postgres unique constraints are the real guarantee (`docs/DATABASE.md`). After Redis comes back:
- Rate limiting resumes enforcing (it fails open while Redis is down — see `docs/API.md`).
- Duplicate prevention temporarily runs "slow path only" — the pipeline re-does search/extract/validate for creators already in Postgres until Redis marks them seen again, but `store_conflict` in `apps/backend/src/routes/ingest.ts` still prevents any actual duplicate row. No manual cleanup needed.
- Idempotency replay (`Idempotency-Key`) stops working for keys used during the outage — a retried request with the same key will re-run the pipeline instead of replaying. Not dangerous (duplicate prevention still holds), just not idempotent for that window.

### Roll back a bad deploy

See `DEPLOYMENT.md` "Rollback" for the schema/data-safety details. Operationally: redeploy the previous image/commit for the affected service(s); the backend and each Python service are independently deployable and stateless, so this doesn't require a coordinated multi-service rollback unless the bad deploy was a Prisma migration.

### Respond to a downstream service circuit breaker stuck open

`circuit_breaker_state{service="search"|"extractor"|"validator"} == 2` sustained means that service has failed `CIRCUIT_BREAKER_THRESHOLD` (default 5) consecutive calls and the breaker is refusing new calls (failing fast with `503`) rather than piling up retries.

1. Check that service's own health/logs directly (`GET http://<service>:<port>/health`) — is it actually down, slow, or erroring?
2. Fix the underlying service issue first; the breaker self-recovers via a half-open probe 10s after opening (`apps/backend/src/services/resilience.ts`) — no manual "reset" action exists or is needed.
3. If the service is healthy but the breaker won't close, check whether `REQUEST_TIMEOUT` is too aggressive for current load/network conditions (timeouts count as failures toward the breaker threshold).

## Disaster recovery

**Status (Sprint 6): Redis-flush recovery, worker-crash recovery, and app-process cold-start reconnection all live-verified (see `RELEASE.md` Sprint 6 RC report for exact test procedures/results). Postgres backup-restore procedure still documented-only, not yet drilled** — an actual Supabase *backup restore* (and an actual Postgres *server* restart) requires dashboard/billing/infrastructure access this session didn't have; only the documented procedure below has been reviewed, not executed end-to-end. Run that drill for real the first time someone has Supabase dashboard access, then update this line with the date and outcome.

### Postgres restore (Supabase)

All four services (`apps/backend`, `apps/ai`, `apps/email`, `apps/admin`) share **one physical Supabase Postgres database**, isolated into four schemas (`public`/`ai`/`email`/`admin` — `docs/DATABASE.md` "Per-service schema isolation"). This means **one backup/restore covers all four schemas at once** — there is no way to restore one service's data independently of the others, since they're the same underlying database file/snapshot. Plan around this: a restore always affects every service simultaneously.

1. In the Supabase dashboard: Project -> Database -> Backups. Confirm what's available — daily automated backups (free/pro tiers) or Point-in-Time Recovery to any second within the retention window (paid tiers with PITR enabled). Know which one your project actually has *before* an incident, not during one.
2. Trigger a restore to a **new** project/branch if your plan supports it, rather than restoring in place — lets you verify the restored data before cutting traffic over, and gives you a rollback path if the restore itself was wrong (restoring the wrong point in time, etc.).
3. Post-restore, before resuming traffic, run `npx prisma migrate status` **in each of the four service directories** (`apps/backend`, `apps/ai`, `apps/email`, `apps/admin`) — each has its own independent `_prisma_migrations` history scoped to its schema, so one service being current doesn't imply another is:
   ```bash
   cd apps/backend && npx prisma migrate status   # repeat for apps/ai, apps/email, apps/admin
   ```
   If any reports pending migrations, run `npx prisma migrate deploy` in that directory against the restored database to bring it current before pointing that service at it.
4. Spot-check row counts / a few known rows against what you expected at the backup timestamp, per schema.
5. Update each service's `*_DATABASE_URL`/`*_DIRECT_URL` to point at the restored database (or, if restored in-place, no config change needed) and restart all four services (graceful `SIGTERM`, see `DEPLOYMENT.md`).
6. Confirm each service's `GET /ready` reports `postgres: ok`.
7. **`apps/admin` specifically**: a restore to an older point in time may resurrect since-deleted `admin_users` rows (previously-revoked access re-appearing) or lose `audit_log` rows written after the backup point (a gap in the audit trail, not silently wrong data — the restore itself should be logged as an operational event to explain the gap).

**RPO/RTO**: bounded by your Supabase plan's backup frequency/PITR window (RPO) and how long dashboard restore + steps 3-6 take (RTO, typically minutes once the restore itself completes — Supabase's own restore time depends on database size, outside this app's control). Confirm actual numbers against your specific plan; don't assume.

### Redis recovery (Upstash)

Redis holds no data that isn't safely reconstructable — see "Recover from a full Redis flush/outage" above. This now also covers `apps/email`'s BullMQ send queue (see "Worker/queue recovery" below) and every service's rate-limit counters. There is no restore procedure to test because there's nothing that needs restoring: an empty/fresh Upstash database is a valid recovery state on its own. If Upstash's own dashboard shows a snapshot/backup feature for your plan, restoring from one is a strict improvement (repopulates caches faster, preserves in-flight queue jobs) but is never required for correctness.

To simulate this failure mode deliberately (e.g. as part of a DR game day): `redis-cli -u "$REDIS_URL" FLUSHALL` against a **non-production** Redis instance, then confirm each service continues serving `/api/v1/*` traffic (degraded — see "Recover from a full Redis flush/outage") and self-heals as new keys get written. Never run `FLUSHALL` against a real instance outside of a deliberate, approved drill.

**Live-verified during Sprint 6** (real shared dev Upstash instance, mock provider, no real send): sent a 3-recipient campaign, then ran `FLUSHALL` against Redis while all 3 jobs were still `delayed` (before any of them had sent). Confirmed all three Node services stayed up and `/ready` continued reporting correctly (`redis: ok` once Upstash's own connection re-established, `postgres: ok` throughout — Redis loss doesn't take Postgres connectivity down with it). The campaign's recipients remained `"queued"` in Postgres (the durable source of truth) even though their BullMQ jobs had vanished entirely. Recovery: `POST /campaigns/:id/pause` then `POST /campaigns/:id/resume` re-enqueued all 3 as fresh jobs, and all 3 completed successfully with exactly one `email_events` "sent" row per recipient (verified via direct query) -- no data loss, no duplicate sends. Note: `pauseCampaign()`'s response distinguishes a job that's `missingFromQueue` (this scenario) from one that's genuinely `stillInFlight`/active (Sprint 6 fix, found via this exact drill -- see `docs/API.md` "POST /campaigns/:id/pause").

### Worker/queue recovery (apps/email)

`apps/email`'s worker process (`npm run start:worker`, `DEPLOYMENT.md` "Deploying apps/email") is stateless — all job state lives in Redis (BullMQ) and Postgres (`campaign_recipients.status`), never in the worker process's own memory. **Live-verified during Sprint 6**: sent a 4-recipient campaign, waited for the first send to complete, then force-killed the worker process (`taskkill`) while the remaining 3 jobs were still `delayed` (not yet picked up). Confirmed via `GET /campaigns/:id/status` that the campaign was left in a clean, consistent state (1 `sent`, 3 `queued`, nothing stuck or corrupted) with no worker running. Restarted the worker process — it resumed consuming the existing delayed jobs from Redis normally and completed all 3 remaining sends with exactly one `email_events` "sent" row per recipient (verified via direct query), no duplicates, no drops. This specifically exercises "delayed jobs survive a worker crash because they live in Redis, not worker memory" — it does **not** specifically test BullMQ's stalled-job/lock-expiry reclaim path for a job that was `active` (mid-processing) at the exact moment of the crash, which is a narrower race window not exercised here; that path is a BullMQ library guarantee, not custom code in this repo.

### Database restart recovery

Actually restarting the Postgres *server* itself isn't something this session had infrastructure access to do (same constraint as the Postgres backup-restore drill above — needs Supabase dashboard/billing access). What **was** live-verified during Sprint 6 is the app-process side of this: force-killed `apps/ai`'s running process, confirmed the port stopped responding entirely (not degraded -- fully down, since there was no in-memory state left to serve stale reads from), then cold-started a brand-new process. The new process's own boot-time dependency check (`startup_check_ok` in its structured logs) succeeded immediately, and `GET /ready` reported `postgres: ok`/`redis: ok` on the very first request -- confirming a freshly-started process establishes a working Prisma connection from nothing, without any special reconnection logic needed (each request gets a connection from Prisma's own pool, which doesn't require anything to have been "warm").

**A real, useful finding from this drill, not the one originally assumed**: `ts-node-dev --respawn` (used for local dev, `npm run dev`) does **not** automatically restart the child process after a forceful kill (`taskkill`/`SIGKILL`) -- its `--respawn` flag only triggers on source file changes, not on an unexpected process exit. The service stayed down until manually restarted. This is a dev-tooling behavior, not a `docs/DATABASE.md` "Connection resilience" concern -- in a real deployment, the *orchestrator* (systemd, Kubernetes, PM2, ECS) is what's responsible for restarting a crashed process, exactly as `DEPLOYMENT.md` already assumes ("whatever orchestrator manages the process... must be configured to send a graceful-stop signal and wait for exit") -- but it's worth knowing `ts-node-dev` itself won't paper over a real crash locally, so a crash during local development needs a manual `npm run dev` restart, not just watching logs for a respawn that isn't coming.

### What "disaster recovery" does *not* cover here

- No cross-region failover — Supabase/Upstash are each single-region for this project; a regional outage of either provider is an availability incident to wait out, not something this app can route around today.
- No automated backup verification job — "the backup exists" is not the same as "the backup restores cleanly"; the manual drill above is the only current verification, so schedule it periodically (e.g. quarterly), not just once.
- No documented recovery procedure for a corrupted (not merely unavailable) `admin_users`/`audit_log` schema specifically beyond the shared Postgres restore above — `apps/admin` has no separate backup cadence of its own.

## Scaling notes

- Backend and all three Python services are stateless and horizontally scalable — add instances behind a load balancer; rate limiting and idempotency are already Redis-backed so they stay correct across multiple backend instances.
- `POST /api/v1/ingest/run` is synchronous per request (`DEPLOYMENT.md` "Known operational limits") — under high concurrent ingest load, HTTP connections stay open for the full pipeline duration. There is no job queue yet; if ingest volume grows significantly beyond `PROJECT.md`'s 200/day target, that's the first architectural change to plan (see "Recommended Next Sprint" in the readiness report).
- Supabase/Upstash free-tier connection limits are the likely first ceiling when adding backend instances — check the plan's connection cap against `(instances × Prisma connection_limit)` (`docs/DATABASE.md` "Connection pooling") before scaling out.
