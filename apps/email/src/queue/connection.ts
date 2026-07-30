import Redis from "ioredis";
import { env } from "../config/env";

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its Redis connection --
 * it uses blocking commands (BRPOPLPUSH etc.) that must be allowed to wait
 * indefinitely; the app-level "fail fast" ioredis settings used elsewhere in
 * this repo (apps/backend, apps/ai: maxRetriesPerRequest: 2) are wrong for
 * this specific connection and would break BullMQ's blocking reads.
 */
export function createQueueConnection(): Redis {
  return new Redis(env.redisUrl, { maxRetriesPerRequest: null });
}
