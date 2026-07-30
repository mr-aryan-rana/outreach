import Redis from "ioredis";
import { env } from "../config/env";

export function createRedisClient(): Redis {
  return new Redis(env.redisUrl, {
    // Default ioredis retry behavior (up to 20 retries with backoff per
    // command) meant a single command sent while Redis was unreachable could
    // block for 10+ seconds before failing -- observed during verification
    // to stall every request through the rate limiter, since it touches
    // Redis on every request. Fail faster; callers (esp. the rate limiter)
    // decide how to degrade instead of blocking on ioredis's own retries.
    maxRetriesPerRequest: 2,
    commandTimeout: 2000,
  });
}

function emailKey(email: string): string {
  return `creator:email:${email.toLowerCase()}`;
}

function websiteKey(url: string): string {
  // Keyed on the full URL, not just the hostname: instagram.com/youtube.com/
  // tiktok.com URLs all share one hostname per platform, so a hostname-only
  // key would treat every creator on that platform as a duplicate of the
  // first one processed in a given cache window.
  const parsed = new URL(url);
  const normalized = `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  return `creator:website:${normalized}`;
}

export class DuplicateChecker {
  constructor(private readonly redis: Redis) {}

  async isDuplicateEmail(email: string): Promise<boolean> {
    return (await this.redis.exists(emailKey(email))) === 1;
  }

  async markEmailSeen(email: string): Promise<void> {
    await this.redis.set(emailKey(email), "1", "EX", env.cacheTtlSeconds);
  }

  async isDuplicateWebsite(url: string): Promise<boolean> {
    return (await this.redis.exists(websiteKey(url))) === 1;
  }

  async markWebsiteSeen(url: string): Promise<void> {
    await this.redis.set(websiteKey(url), "1", "EX", env.cacheTtlSeconds);
  }
}
