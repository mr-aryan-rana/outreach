import { registry } from "../src/services/metrics";
import { createResiliencePolicy } from "../src/services/resilience";

function readGauge(metricsText: string, serviceName: string): string | undefined {
  const match = metricsText.match(new RegExp(`circuit_breaker_state\\{service="${serviceName}"\\} (\\d+)`));
  return match?.[1];
}

// Regression: CircuitState is a numeric enum (Closed=0, Open=1, HalfOpen=2,
// Isolated=3). state.toString() yields "0"/"1"/etc, not "closed"/"open". A
// previous string-keyed lookup here always missed and silently fell back to
// 0, so circuit_breaker_state never reflected reality no matter what the
// breaker actually did. This exercises a real breaker through open, once
// bypassing the previous bug's "always looks closed" symptom.
describe("createResiliencePolicy circuit breaker metric", () => {
  it("reports the real breaker state (moves off 0 when the breaker actually opens)", async () => {
    process.env.CIRCUIT_BREAKER_THRESHOLD = "2";
    jest.resetModules();
    const { createResiliencePolicy: freshCreatePolicy } = require("../src/services/resilience");
    const { registry: freshRegistry } = require("../src/services/metrics");

    const policy = freshCreatePolicy("resilience-test-open");
    const alwaysFails = () => Promise.reject(new Error("boom"));

    for (let i = 0; i < 3; i++) {
      await policy.execute(alwaysFails).catch(() => undefined);
    }

    const metricsText = await freshRegistry.metrics();
    const value = readGauge(metricsText, "resilience-test-open");
    expect(value).toBeDefined();
    expect(value).not.toBe("0");

    delete process.env.CIRCUIT_BREAKER_THRESHOLD;
  });

  it("stays at 0 (closed) for a policy that only sees successful calls", async () => {
    createResiliencePolicy("resilience-test-closed");
    const metricsText = await registry.metrics();
    expect(metricsText).toMatch(/circuit_breaker_state\{service="resilience-test-closed"\} 0/);
  });
});
