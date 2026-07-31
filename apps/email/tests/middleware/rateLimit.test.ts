import { RedisFixedWindowStore } from "../../src/middleware/rateLimit";

function fakeRedis(initial: Record<string, number> = {}) {
  const store = new Map<string, number>();
  const ttls = new Map<string, number>();
  for (const [k, v] of Object.entries(initial)) store.set(k, v);

  return {
    incr: jest.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    pexpire: jest.fn(async (key: string, ms: number) => {
      ttls.set(key, ms);
      return 1;
    }),
    pttl: jest.fn(async (key: string) => ttls.get(key) ?? -1),
    decr: jest.fn(async () => 0),
    del: jest.fn(async () => 1),
  } as any;
}

describe("RedisFixedWindowStore", () => {
  it("sets a TTL on the very first increment", async () => {
    const redis = fakeRedis();
    const store = new RedisFixedWindowStore(redis, "test:");

    const result = await store.increment("ip1");

    expect(result.totalHits).toBe(1);
    expect(redis.pexpire).toHaveBeenCalledWith("test:ip1", store.windowMs);
  });

  it("does not re-set the TTL on a normal subsequent increment within the window", async () => {
    const redis = fakeRedis();
    redis.pttl.mockResolvedValue(30_000); // still has time left
    const store = new RedisFixedWindowStore(redis, "test:");

    // Simulate totalHits already at 2 (not the first hit) with a healthy TTL.
    redis.incr.mockResolvedValueOnce(2);
    await store.increment("ip1");

    expect(redis.pexpire).not.toHaveBeenCalled();
  });

  // Regression: found live during Sprint 5 testing -- a key that somehow
  // ended up with totalHits > 1 and NO ttl (pttl returns -1, meaning it
  // will never expire) used to permanently rate-limit that caller until
  // someone manually cleared Redis. The store must now self-heal by
  // re-arming the TTL any time it's missing, not only on the literal first
  // hit.
  it("self-heals a key that has hits but no TTL (would otherwise never reset)", async () => {
    const redis = fakeRedis();
    redis.incr.mockResolvedValueOnce(138); // many hits already recorded
    redis.pttl.mockResolvedValueOnce(-1); // but no expiry set -- the bug

    const store = new RedisFixedWindowStore(redis, "test:");
    const result = await store.increment("stuck-key");

    expect(result.totalHits).toBe(138);
    expect(redis.pexpire).toHaveBeenCalledWith("test:stuck-key", store.windowMs);
    expect(result.resetTime?.getTime()).toBeGreaterThan(Date.now());
  });

  it("fails open (does not throw, allows the request) if Redis is unreachable", async () => {
    const redis = fakeRedis();
    redis.incr.mockRejectedValue(new Error("ECONNREFUSED"));
    const store = new RedisFixedWindowStore(redis, "test:");

    const result = await store.increment("ip1");

    expect(result.totalHits).toBe(1);
  });
});
