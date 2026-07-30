import Redis from "ioredis";
import { hasRealRedis } from "./shouldRun";

const describeIfConfigured = hasRealRedis() ? describe : describe.skip;

if (!hasRealRedis()) {
  // eslint-disable-next-line no-console
  console.log("[integration] Skipping redis.integration.test.ts: set a real Upstash REDIS_URL in .env to run this.");
}

describeIfConfigured("Redis (real Upstash instance)", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL as string);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  it("responds to PING", async () => {
    expect(await redis.ping()).toBe("PONG");
  });

  it("sets and expires keys (duplicate-cache pattern)", async () => {
    const key = `integration-test:${Date.now()}`;
    await redis.set(key, "1", "EX", 5);
    expect(await redis.get(key)).toBe("1");
    await redis.del(key);
    expect(await redis.get(key)).toBeNull();
  });

  it("supports NX locks (idempotency pattern)", async () => {
    const key = `integration-test:lock:${Date.now()}`;
    const first = await redis.set(key, "1", "EX", 5, "NX");
    const second = await redis.set(key, "1", "EX", 5, "NX");
    expect(first).toBe("OK");
    expect(second).toBeNull();
    await redis.del(key);
  });
});
