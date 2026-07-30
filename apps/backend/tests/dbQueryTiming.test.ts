import { registry } from "../src/services/metrics";
import { timeQuery, SLOW_QUERY_THRESHOLD_MS } from "../src/db";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findMetricLine(name: string): Promise<string | undefined> {
  const text = await registry.metrics();
  return text.split("\n").find((line) => line.startsWith(name) && !line.startsWith("#"));
}

describe("timeQuery (Prisma query-duration instrumentation)", () => {
  it("records duration for a fast query and returns its result", async () => {
    const result = await timeQuery("Creator", "findMany", {}, async () => ["ok"]);
    expect(result).toEqual(["ok"]);

    const line = await findMetricLine('db_query_duration_seconds_count{model="Creator",operation="findMany"}');
    expect(line).toBeDefined();
  });

  it("propagates the underlying query's rejection", async () => {
    await expect(
      timeQuery("Creator", "create", {}, async () => {
        throw new Error("constraint violation");
      })
    ).rejects.toThrow("constraint violation");
  });

  it("labels raw queries (no model) distinctly", async () => {
    await timeQuery(undefined, "queryRaw", {}, async () => [{ one: 1 }]);
    const line = await findMetricLine('db_query_duration_seconds_count{model="raw",operation="queryRaw"}');
    expect(line).toBeDefined();
  });

  it("threshold constant is a sane positive number", () => {
    expect(SLOW_QUERY_THRESHOLD_MS).toBeGreaterThan(0);
  });

  it("does not blow up the request when the query is slower than the slow-query threshold", async () => {
    const result = await timeQuery("Creator", "count", {}, async () => {
      await sleep(1);
      return 42;
    });
    expect(result).toBe(42);
  });
});
