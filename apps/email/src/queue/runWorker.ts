// Process entrypoint for the queue worker -- run as a separate process from
// the API server (`npm run worker` / `npm run start:worker`), same reason
// BullMQ workers are conventionally separate from the API layer: sends are
// I/O-bound and rate-limited (PROJECT.md's daily/hourly caps), scaling them
// independently from HTTP request handling capacity is the point.
import { prisma } from "../db";
import { logger } from "../logger";
import { closeQueues } from "./emailQueue";
import { startEmailWorker } from "./worker";

const worker = startEmailWorker();
logger.info({ event: "email_worker_started" });

process.on("unhandledRejection", (reason) => {
  logger.error({ event: "unhandled_rejection", reason: reason instanceof Error ? reason.message : String(reason) });
});
process.on("uncaughtException", (err) => {
  logger.error({ event: "uncaught_exception", error: err.message, stack: err.stack });
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: "worker_shutdown_started", signal });
  const forceExitTimer = setTimeout(() => {
    logger.error({ event: "worker_shutdown_forced" });
    process.exit(1);
  }, 15_000);
  forceExitTimer.unref();

  try {
    await worker.close(); // lets any in-progress job finish before closing
    await closeQueues();
    await prisma.$disconnect();
    logger.info({ event: "worker_shutdown_complete" });
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    logger.error({ event: "worker_shutdown_error", error: (err as Error).message });
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
