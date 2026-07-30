import rateLimit, { Store, IncrementResponse } from "express-rate-limit";
import Redis from "ioredis";
import { env } from "../config/env";

class RedisFixedWindowStore implements Store {
  windowMs = env.rateLimitWindowMs;

  constructor(private readonly redis: Redis, private readonly keyPrefix: string) {}

  private key(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const redisKey = this.key(key);
    try {
      const totalHits = await this.redis.incr(redisKey);
      if (totalHits === 1) {
        await this.redis.pexpire(redisKey, this.windowMs);
      }
      const ttl = await this.redis.pttl(redisKey);
      const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs));
      return { totalHits, resetTime };
    } catch (err) {
      // Fail open: a rate limiter that can't reach its own store must not
      // block all API traffic. Observed during verification -- a Redis
      // outage made every request (including ones with no other Redis
      // dependency) hang for 10+ seconds and then 500. Report hit 1 (always
      // under the limit) so the request proceeds; the limiter resumes
      // enforcing once Redis recovers.
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    await this.redis.decr(this.key(key)).catch(() => undefined);
  }

  async resetKey(key: string): Promise<void> {
    await this.redis.del(this.key(key)).catch(() => undefined);
  }
}

export function buildGeneralRateLimiter(redis: Redis) {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisFixedWindowStore(redis, "ratelimit:general:"),
  });
}

export function buildIngestRateLimiter(redis: Redis) {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.ingestRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisFixedWindowStore(redis, "ratelimit:ingest:"),
    // This limiter intentionally stacks on top of the general one for the
    // same request (general + ingest-specific), which the library's
    // double-count heuristic otherwise flags as a likely bug.
    validate: { singleCount: false },
  });
}
