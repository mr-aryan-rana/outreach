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
import { circuitBreakerState } from "./metrics";

export { BrokenCircuitError };

// CircuitState is a numeric enum (Closed=0, Open=1, HalfOpen=2, Isolated=3),
// not a string -- `state.toString()` yields "0"/"1"/"2"/"3", not
// "closed"/"open"/etc. A previous string-keyed lookup here always missed and
// silently fell back to 0, so the circuit_breaker_state metric never
// reflected reality regardless of actual breaker state. Map cockatiel's
// numeric state directly to our own gauge semantics instead (0=closed,
// 1=half-open, 2=open, matching the metric's documented HELP text).
const CIRCUIT_STATE_VALUE: Record<number, number> = {
  [CircuitState.Closed]: 0,
  [CircuitState.HalfOpen]: 1,
  [CircuitState.Open]: 2,
  [CircuitState.Isolated]: 2,
};

export function createResiliencePolicy(serviceName: string): IPolicy {
  const timeoutPolicy = timeout(env.requestTimeoutMs, TimeoutStrategy.Aggressive);
  const breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: 10_000,
    breaker: new ConsecutiveBreaker(env.circuitBreakerThreshold),
  });
  const retryPolicy = retry(handleAll, { maxAttempts: 2, backoff: new ExponentialBackoff() });

  // Initialize explicitly so the metric reads "closed" from process start
  // instead of being absent from /metrics until the first state change.
  circuitBreakerState.labels(serviceName).set(0);

  breakerPolicy.onStateChange((state) => {
    circuitBreakerState.labels(serviceName).set(CIRCUIT_STATE_VALUE[state] ?? 0);
  });

  return wrap(retryPolicy, breakerPolicy, timeoutPolicy);
}
