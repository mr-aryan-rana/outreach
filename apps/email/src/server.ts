import Redis from "ioredis";
import { buildApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db";
import { logger } from "./logger";

const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2, commandTimeout: 2000 });
redis.on("error", (err) => logger.error({ event: "redis_client_error", error: err.message }));

const app = buildApp({ redis });

process.on("unhandledRejection", (reason) => {
  logger.error({ event: "unhandled_rejection", reason: reason instanceof Error ? reason.message : String(reason) });
});
process.on("uncaughtException", (err) => {
  logger.error({ event: "uncaught_exception", error: err.message, stack: err.stack });
  process.exit(1);
});

async function logStartupDependencyCheck(): Promise<void> {
  const [dbResult, redisResult] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
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

// Reminder for anyone reading this at boot time, not just in docs: this
// process serves the API only. Sends only happen in the separate worker
// process (`npm run worker` / `npm run start:worker`, src/queue/runWorker.ts)
// -- starting only this server does not send any email.
logger.info({ event: "note", message: "API server only -- run the worker process separately to actually send queued emails" });

const httpServer = app.listen(env.port, () => {
  logger.info({ event: "server_started", port: env.port });
});

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
