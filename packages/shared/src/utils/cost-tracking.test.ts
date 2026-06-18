import { describe, it, expect } from "vitest";
import { calculateLlmCostUsd, formatCostUsd } from "./cost-tracking.ts";

// These tests verify the billing math that drives the daily cost cap.
// A wrong formula here would either block agents prematurely or let
// spend spiral past the hard cap — both are production-critical bugs.

describe("calculateLlmCostUsd", () => {
  describe("claude-haiku-4-5-20251001", () => {
    it("calculates cost for 1M input tokens", () => {
      // $0.80 per 1M input tokens
      const cost = calculateLlmCostUsd("claude-haiku-4-5-20251001", 1_000_000, 0);
      expect(cost).toBeCloseTo(0.8);
    });

    it("calculates cost for 1M output tokens", () => {
      // $4.00 per 1M output tokens
      const cost = calculateLlmCostUsd("claude-haiku-4-5-20251001", 0, 1_000_000);
      expect(cost).toBeCloseTo(4.0);
    });

    it("calculates combined input + output cost", () => {
      // 500k input ($0.40) + 500k output ($2.00) = $2.40
      const cost = calculateLlmCostUsd("claude-haiku-4-5-20251001", 500_000, 500_000);
      expect(cost).toBeCloseTo(2.4);
    });

    it("returns zero for zero tokens", () => {
      expect(calculateLlmCostUsd("claude-haiku-4-5-20251001", 0, 0)).toBe(0);
    });
  });

  describe("claude-sonnet-4-6", () => {
    it("calculates cost for 1M input tokens", () => {
      // $3.00 per 1M input tokens
      const cost = calculateLlmCostUsd("claude-sonnet-4-6", 1_000_000, 0);
      expect(cost).toBeCloseTo(3.0);
    });

    it("calculates cost for 1M output tokens", () => {
      // $15.00 per 1M output tokens
      const cost = calculateLlmCostUsd("claude-sonnet-4-6", 0, 1_000_000);
      expect(cost).toBeCloseTo(15.0);
    });

    it("a typical CEO Brain call (2000 prompt + 800 completion)", () => {
      // $3.00 * (2000/1M) + $15.00 * (800/1M)
      // = $0.006 + $0.012 = $0.018
      const cost = calculateLlmCostUsd("claude-sonnet-4-6", 2000, 800);
      expect(cost).toBeCloseTo(0.018, 5);
    });
  });

  describe("gpt-4o-mini", () => {
    it("calculates cost for 1M input tokens", () => {
      // $0.15 per 1M input tokens
      const cost = calculateLlmCostUsd("gpt-4o-mini", 1_000_000, 0);
      expect(cost).toBeCloseTo(0.15);
    });
  });

  describe("text-embedding-3-small", () => {
    it("has zero output cost (embeddings have no output tokens)", () => {
      const cost = calculateLlmCostUsd("text-embedding-3-small", 100_000, 0);
      expect(cost).toBeCloseTo(0.002);
    });

    it("output tokens produce zero cost", () => {
      // Embedding models don't generate tokens — passing completionTokens is a
      // caller bug, but the function should not penalise it.
      const withOutput = calculateLlmCostUsd("text-embedding-3-small", 0, 1_000_000);
      expect(withOutput).toBe(0);
    });
  });
});

describe("formatCostUsd", () => {
  it("formats zero as $0.0000", () => {
    expect(formatCostUsd(0)).toBe("$0.0000");
  });

  it("formats a small cost with 4 decimal places", () => {
    expect(formatCostUsd(0.0018)).toBe("$0.0018");
  });

  it("formats a larger cost correctly", () => {
    expect(formatCostUsd(12.3456)).toBe("$12.3456");
  });

  it("rounds to 4 decimal places", () => {
    expect(formatCostUsd(0.00001)).toBe("$0.0000");
    expect(formatCostUsd(0.00005)).toBe("$0.0001");
  });
});
