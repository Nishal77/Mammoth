import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  circuitBreakerRegistry,
} from "./circuit-breaker.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Succeeds immediately — represents a healthy external API call. */
const succeed = async (): Promise<string> => "ok";

/** Fails immediately — represents a failing external API call. */
const fail = async (): Promise<never> => {
  throw new Error("external service down");
};

// ─── State transitions ────────────────────────────────────────────────────────

describe("CircuitBreaker — state transitions", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: "test-service",
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
  });

  it("starts in CLOSED state", () => {
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("stays CLOSED after fewer failures than threshold", async () => {
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("opens after reaching the failure threshold", async () => {
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");
  });

  it("throws CircuitBreakerOpenError immediately when OPEN", async () => {
    // Trip the breaker.
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    expect(breaker.getState()).toBe("OPEN");

    // Next call should be rejected immediately, not reaching the external service.
    await expect(breaker.execute(succeed)).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("transitions to HALF_OPEN after reset timeout elapses", async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    expect(breaker.getState()).toBe("OPEN");

    vi.advanceTimersByTime(1001); // past the 1000ms timeout

    // The next execute() transitions to HALF_OPEN and lets one call through.
    // Since our fn succeeds, it will close immediately.
    const result = await breaker.execute(succeed);
    expect(result).toBe("ok");
    expect(breaker.getState()).toBe("CLOSED");

    vi.useRealTimers();
  });

  it("goes back to OPEN when HALF_OPEN test call fails", async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }

    vi.advanceTimersByTime(1001);

    // Test call fails → back to OPEN.
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");

    vi.useRealTimers();
  });

  it("resets to CLOSED and clears failure count on success", async () => {
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.getFailureCount()).toBe(2);

    // One success resets everything.
    await breaker.execute(succeed);
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getFailureCount()).toBe(0);
  });
});

// ─── Manual reset ─────────────────────────────────────────────────────────────

describe("CircuitBreaker — manual reset", () => {
  it("reset() brings an OPEN circuit back to CLOSED immediately", async () => {
    const breaker = new CircuitBreaker({
      name: "manual-reset",
      failureThreshold: 2,
      resetTimeoutMs: 60_000,
    });

    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");

    breaker.reset();
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getFailureCount()).toBe(0);
  });
});

// ─── Error passthrough ────────────────────────────────────────────────────────

describe("CircuitBreaker — error passthrough", () => {
  it("re-throws the original error from fn(), not a wrapped error", async () => {
    const breaker = new CircuitBreaker({ name: "passthrough", failureThreshold: 5 });
    const originalError = new Error("rate limit hit");

    await expect(
      breaker.execute(async () => { throw originalError; })
    ).rejects.toThrow("rate limit hit");
  });

  it("CircuitBreakerOpenError includes the service name", async () => {
    const breaker = new CircuitBreaker({ name: "hubspot", failureThreshold: 1 });
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(succeed)).rejects.toThrow(/hubspot/);
  });
});

// ─── Default options ──────────────────────────────────────────────────────────

describe("CircuitBreaker — default options", () => {
  it("uses failureThreshold=5 by default", async () => {
    const breaker = new CircuitBreaker({ name: "defaults" });

    for (let i = 0; i < 4; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    // Still closed at 4 failures.
    expect(breaker.getState()).toBe("CLOSED");

    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");
  });
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe("circuitBreakerRegistry", () => {
  it("returns the same instance for the same name", () => {
    const first = circuitBreakerRegistry.get("shared-service");
    const second = circuitBreakerRegistry.get("shared-service");
    expect(first).toBe(second);
  });

  it("getAllStates() returns CLOSED for a fresh breaker", () => {
    circuitBreakerRegistry.get("fresh-service-a");
    const states = circuitBreakerRegistry.getAllStates();
    expect(states["fresh-service-a"]).toBe("CLOSED");
  });

  it("getAllStates() reflects OPEN when a breaker trips", async () => {
    const breaker = circuitBreakerRegistry.get("fresh-service-b", {
      failureThreshold: 1,
    });

    await expect(breaker.execute(fail)).rejects.toThrow();
    const states = circuitBreakerRegistry.getAllStates();
    expect(states["fresh-service-b"]).toBe("OPEN");
  });
});
