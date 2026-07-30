// Requires an explicit opt-in (RUN_INTEGRATION_TESTS=true) in addition to a
// real-looking URL, so these tests never run against whatever happens to be
// sitting in DATABASE_URL/REDIS_URL unless the person running them means it.
const OPTED_IN = process.env.RUN_INTEGRATION_TESTS === "true";

export function hasRealDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  return OPTED_IN && !!url && !url.includes("localhost") && !url.includes("<");
}

export function hasRealRedis(): boolean {
  const url = process.env.REDIS_URL;
  return OPTED_IN && !!url && !url.includes("localhost") && !url.includes("<");
}
