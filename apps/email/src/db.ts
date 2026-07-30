import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";
import { dbQueryDuration } from "./services/metrics";

export const SLOW_QUERY_THRESHOLD_MS = 500;

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

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        return timeQuery(model, operation, args, query);
      },
    },
  },
});
