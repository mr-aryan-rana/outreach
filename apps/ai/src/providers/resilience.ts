import {
  BrokenCircuitError,
  circuitBreaker,
  CircuitState,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  IPolicy,
  retry,
  timeout,
  TimeoutStrategy,
  wrap,
} from "cockatiel";
import { env } from "../config/env";
import { circuitBreakerState } from "../services/metrics";

export { BrokenCircuitError };

// Same numeric-enum mapping fix as apps/backend/src/services/resilience.ts
// -- see there for why the naive string-keyed version silently always read 0.
const CIRCUIT_STATE_VALUE: Record<number, number> = {
  [CircuitState.Closed]: 0,
  [CircuitState.HalfOpen]: 1,
  [CircuitState.Open]: 2,
  [CircuitState.Isolated]: 2,
};

const policies = new Map<string, IPolicy>();
const circuitStates = new Map<string, "closed" | "half_open" | "open">();

const STATE_NAME: Record<number, "closed" | "half_open" | "open"> = {
  [CircuitState.Closed]: "closed",
  [CircuitState.HalfOpen]: "half_open",
  [CircuitState.Open]: "open",
  [CircuitState.Isolated]: "open",
};

/**
 * Readable counterpart to the circuit_breaker_state Prometheus gauge --
 * Prometheus is a write-only sink from this process's perspective, so
 * GET /api/v1/ai/providers/health (Sprint 6) needs its own in-memory record
 * to report current breaker state without scraping its own /metrics.
 */
export function getCircuitState(providerName: string): "closed" | "half_open" | "open" {
  return circuitStates.get(providerName) ?? "closed";
}

/**
 * One retry+breaker+timeout policy per provider, created lazily and cached
 * (not per-call) so the circuit breaker's failure count is meaningful across
 * calls -- a fresh breaker every call would never actually open.
 */
export function getResiliencePolicy(providerName: string): IPolicy {
  const existing = policies.get(providerName);
  if (existing) return existing;

  const timeoutPolicy = timeout(env.requestTimeoutMs, TimeoutStrategy.Aggressive);
  const breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: 10_000,
    breaker: new ConsecutiveBreaker(env.circuitBreakerThreshold),
  });
  // LLM calls are expensive (latency + cost) -- only 1 retry, not 2, unlike
  // the cheap internal HTTP calls in apps/backend's resilience.ts.
  const retryPolicy = retry(handleAll, { maxAttempts: 1, backoff: new ExponentialBackoff() });

  circuitBreakerState.labels(providerName).set(0);
  circuitStates.set(providerName, "closed");
  breakerPolicy.onStateChange((state) => {
    circuitBreakerState.labels(providerName).set(CIRCUIT_STATE_VALUE[state] ?? 0);
    circuitStates.set(providerName, STATE_NAME[state] ?? "closed");
  });

  const policy = wrap(retryPolicy, breakerPolicy, timeoutPolicy);
  policies.set(providerName, policy);
  return policy;
}
