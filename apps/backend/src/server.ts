import { buildApp } from "./app";
import { env } from "./config/env";
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

app.listen(env.port, () => {
  logger.info({ event: "server_started", port: env.port });
});
