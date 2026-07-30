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

const CIRCUIT_STATE_VALUE: Record<number, number> = {
  [CircuitState.Closed]: 0,
  [CircuitState.HalfOpen]: 1,
  [CircuitState.Open]: 2,
  [CircuitState.Isolated]: 2,
};

const policies = new Map<string, IPolicy>();

/** One retry+breaker+timeout policy per provider, cached across calls -- see apps/ai's identical pattern for the rationale. */
export function getResiliencePolicy(providerName: string): IPolicy {
  const existing = policies.get(providerName);
  if (existing) return existing;

  const timeoutPolicy = timeout(env.requestTimeoutMs, TimeoutStrategy.Aggressive);
  const breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: 10_000,
    breaker: new ConsecutiveBreaker(env.circuitBreakerThreshold),
  });
  const retryPolicy = retry(handleAll, { maxAttempts: 1, backoff: new ExponentialBackoff() });

  circuitBreakerState.labels(providerName).set(0);
  breakerPolicy.onStateChange((state) => {
    circuitBreakerState.labels(providerName).set(CIRCUIT_STATE_VALUE[state] ?? 0);
  });

  const policy = wrap(retryPolicy, breakerPolicy, timeoutPolicy);
  policies.set(providerName, policy);
  return policy;
}
