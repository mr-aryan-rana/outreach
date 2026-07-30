import Redis from "ioredis";

export class CacheService {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }
}

export function searchCacheKey(platform: string, niche: string): string {
  return `search:${platform.toLowerCase()}:${niche.toLowerCase()}`;
}

export function validationCacheKey(email: string): string {
  return `validation:${email.toLowerCase()}`;
}
