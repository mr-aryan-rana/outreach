import { buildApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db";
import { logger } from "./logger";
import { CacheService } from "./services/cache";
import { createRedisClient, DuplicateChecker } from "./services/duplicateCheck";
import { IdempotencyService } from "./services/idempotency";
import { buildPipeline } from "./services/pipeline";

const redis = createRedisClient();
redis.on("error", (err) => logger.error({ event: "redis_client_error", error: err.message }));

const duplicateChecker = new DuplicateChecker(redis);
const cache = new CacheService(redis);
const idempotency = new IdempotencyService(redis);
const pipeline = buildPipeline(cache);

const app = buildApp({ redis, duplicateChecker, pipeline, idempotency });

// Defense-in-depth beyond the per-route asyncHandler wrapping: catches
// anything originating outside an Express request (e.g. a background client
// event) so a single unexpected error doesn't silently take the process down.
process.on("unhandledRejection", (reason) => {
  logger.error({ event: "unhandled_rejection", reason: reason instanceof Error ? reason.message : String(reason) });
});
process.on("uncaughtException", (err) => {
  logger.error({ event: "uncaught_exception", error: err.message, stack: err.stack });
  process.exit(1);
});

// Startup validation: env.ts already fails fast on missing/malformed config.
// This additionally confirms Postgres/Redis are actually reachable at boot
// and logs it loudly -- catches "credentials present but wrong/expired"
// immediately instead of waiting for the first request to hit /ready or fail.
// Deliberately non-blocking: an orchestrator's own health-check-gated
// rollout (via /ready) is the right place to hold traffic back, not a boot
// delay here.
async function logStartupDependencyCheck(): Promise<void> {
  const [dbResult, redisResult] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
  ]);
  if (dbResult.status === "rejected") {
    logger.error({ event: "startup_check_postgres_unreachable", error: (dbResult.reason as Error).message });
  }
  if (redisResult.status === "rejected") {
    logger.error({ event: "startup_check_redis_unreachable", error: (redisResult.reason as Error).message });
  }
  if (dbResult.status === "fulfilled" && redisResult.status === "fulfilled") {
    logger.info({ event: "startup_check_ok" });
  }
}
void logStartupDependencyCheck();

const httpServer = app.listen(env.port, () => {
  logger.info({ event: "server_started", port: env.port });
});

// Orchestrators (Kubernetes, ECS, ...) send SIGTERM and expect the process to
// stop accepting new connections, finish in-flight requests, then exit --
// not be hard-killed. Without this, in-flight /ingest/run pipeline runs (and
// their Postgres writes) can be cut off mid-request on every rolling deploy.
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: "shutdown_started", signal });

  const forceExitTimer = setTimeout(() => {
    logger.error({ event: "shutdown_forced", reason: "in-flight requests or connections did not close in time" });
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  httpServer.close(async (err) => {
    if (err) {
      logger.error({ event: "shutdown_http_close_error", error: err.message });
    }
    try {
      await Promise.all([prisma.$disconnect(), redis.quit()]);
      logger.info({ event: "shutdown_complete" });
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (closeErr) {
      logger.error({ event: "shutdown_cleanup_error", error: (closeErr as Error).message });
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
