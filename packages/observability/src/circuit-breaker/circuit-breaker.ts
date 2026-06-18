/**
 * Circuit breaker for external API calls.
 *
 * WHY: External services (HubSpot, Stripe, Slack) sometimes go down.
 * Without a circuit breaker, every agent run would hang for 30s waiting for
 * a timeout, burning through the daily cost cap and filling the job queue.
 * The circuit breaker fails fast after repeated failures, then tests recovery.
 *
 * States:
 *   CLOSED  → calls go through normally. Failures increment counter.
 *   OPEN    → calls fail immediately without hitting the external service.
 *             After the reset timeout, transitions to HALF_OPEN.
 *   HALF_OPEN → one test call is allowed through.
 *               Success → CLOSED. Failure → back to OPEN.
 */

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CircuitBreakerOptions = {
  /**
   * How many consecutive failures before the circuit opens.
   * Default: 5
   */
  failureThreshold?: number;
  /**
   * Milliseconds to wait in OPEN state before allowing one test call.
   * Default: 60_000 (1 minute)
   */
  resetTimeoutMs?: number;
  /**
   * Label shown in logs/errors. Use the service name: "hubspot", "stripe".
   */
  name: string;
};

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(
      `Circuit breaker OPEN for "${name}". Too many recent failures. ` +
        `Requests are paused to protect the system. Will retry shortly.`
    );
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAtMs: number | null = null;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  readonly name: string;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
  }

  /**
   * Executes fn() through the circuit breaker.
   * Throws CircuitBreakerOpenError immediately when circuit is OPEN.
   * Throws the original error from fn() and records it as a failure.
   *
   * @param fn - The external call to wrap (e.g. () => fetchHubspotContacts())
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (!this.hasResetTimeoutElapsed()) {
        throw new CircuitBreakerOpenError(this.name);
      }
      // Timeout elapsed — allow one test call through.
      this.state = "HALF_OPEN";
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Returns the current state — useful for health checks and logging. */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /** Returns the current failure count — useful for metrics. */
  getFailureCount(): number {
    return this.consecutiveFailures;
  }

  /**
   * Manually resets the circuit to CLOSED.
   * Useful in tests or when an operator confirms the external service is back.
   */
  reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.openedAtMs = null;
  }

  private onSuccess(): void {
    // Any success resets the failure counter and closes the circuit.
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
    this.openedAtMs = null;
  }

  private onFailure(): void {
    this.consecutiveFailures++;

    if (
      this.state === "HALF_OPEN" ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = "OPEN";
      this.openedAtMs = Date.now();
    }
  }

  private hasResetTimeoutElapsed(): boolean {
    if (this.openedAtMs === null) return false;
    return Date.now() - this.openedAtMs >= this.resetTimeoutMs;
  }
}

/**
 * Registry that holds one CircuitBreaker instance per external service.
 * Singletons — every part of the codebase shares the same breaker state.
 *
 * Usage:
 *   const breaker = circuitBreakerRegistry.get("hubspot");
 *   const contacts = await breaker.execute(() => fetchHubspotContacts(token));
 */
class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  /**
   * Returns the breaker for the given service, creating it if needed.
   * Options only apply on first creation — subsequent calls ignore them.
   */
  get(name: string, options: Omit<CircuitBreakerOptions, "name"> = {}): CircuitBreaker {
    const existing = this.breakers.get(name);
    if (existing) return existing;

    const breaker = new CircuitBreaker({ ...options, name });
    this.breakers.set(name, breaker);
    return breaker;
  }

  /** Returns current state of all registered breakers — for health endpoints. */
  getAllStates(): Record<string, CircuitBreakerState> {
    const states: Record<string, CircuitBreakerState> = {};
    for (const [name, breaker] of this.breakers) {
      states[name] = breaker.getState();
    }
    return states;
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();
