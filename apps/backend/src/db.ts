import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";
import { dbQueryDuration } from "./services/metrics";

export const SLOW_QUERY_THRESHOLD_MS = 500;

// Pure, unit-testable apart from a real Prisma connection: records timing
// and warns on slow queries around whatever `query` function is passed in.
// Feeds db_query_duration_seconds (see monitoring/ for the Grafana panel +
// alert rule).
export async function timeQuery<T>(
  model: string | undefined,
  operation: string,
  args: unknown,
  query: (args: unknown) => Promise<T>
): Promise<T> {
  const start = process.hrtime.bigint();
  const result = await query(args);
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  dbQueryDuration.labels(model ?? "raw", operation).observe(durationMs / 1000);
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    logger.warn({ event: "slow_query", model, operation, durationMs: Math.round(durationMs) });
  }
  return result;
}

const basePrisma = new PrismaClient();

// Client extension (not the deprecated $use middleware) wraps every query
// with timeQuery above -- a degrading query shows up in metrics/logs before
// it becomes an incident, not just after /ready starts failing.
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        return timeQuery(model, operation, args, query);
      },
    },
  },
});
