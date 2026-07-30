import Redis from "ioredis";
import { env } from "../config/env";

const LOCK_TTL_SECONDS = 60;

export type IdempotencyCheck =
  | { state: "new" }
  | { state: "in_progress" }
  | { state: "completed"; result: unknown };

function lockKey(key: string): string {
  return `idempotency:lock:${key}`;
}

function resultKey(key: string): string {
  return `idempotency:result:${key}`;
}

export class IdempotencyService {
  constructor(private readonly redis: Redis) {}

  async check(key: string): Promise<IdempotencyCheck> {
    const stored = await this.redis.get(resultKey(key));
    if (stored) {
      return { state: "completed", result: JSON.parse(stored) };
    }

    const acquired = await this.redis.set(lockKey(key), "1", "EX", LOCK_TTL_SECONDS, "NX");
    if (acquired === null) {
      return { state: "in_progress" };
    }
    return { state: "new" };
  }

  async complete(key: string, result: unknown): Promise<void> {
    await this.redis.set(resultKey(key), JSON.stringify(result), "EX", env.idempotencyTtlSeconds);
    await this.redis.del(lockKey(key));
  }

  async release(key: string): Promise<void> {
    await this.redis.del(lockKey(key));
  }
}
