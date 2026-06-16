import { describe, it, expect } from "vitest";
import {
  PLANS,
  getPlan,
  planHasFeature,
  minimumPlanForFeature,
} from "./plan-definitions.ts";
import type { PlanFeature } from "./plan-definitions.ts";

describe("PLANS", () => {
  it("free plan has 1 max department", () => {
    expect(PLANS.free.maxDepartments).toBe(1);
  });

  it("scale plan has all 9 departments", () => {
    expect(PLANS.scale.maxDepartments).toBe(9);
  });

  it("growth plan costs $99/month", () => {
    expect(PLANS.growth.monthlyPriceCents).toBe(9900);
  });

  it("scale plan costs $299/month", () => {
    expect(PLANS.scale.monthlyPriceCents).toBe(29900);
  });

  it("free plan has $0.50 daily AI cap", () => {
    expect(PLANS.free.maxAiCostPerDayUsd).toBe(0.5);
  });

  it("enterprise plan has no task limit", () => {
    expect(PLANS.enterprise.maxTasksPerDay).toBe(Infinity);
  });
});

describe("getPlan", () => {
  it("returns the correct plan for a known tier", () => {
    expect(getPlan("growth").tier).toBe("growth");
    expect(getPlan("scale").tier).toBe("scale");
  });

  it("falls back to free for an unknown tier", () => {
    expect(getPlan("unknown").tier).toBe("free");
    expect(getPlan("").tier).toBe("free");
  });
});

describe("planHasFeature", () => {
  it("free plan does not have integrations", () => {
    expect(planHasFeature("free", "integrations")).toBe(false);
  });

  it("growth plan has integrations", () => {
    expect(planHasFeature("growth", "integrations")).toBe(true);
  });

  it("growth plan does not have slack_digest", () => {
    expect(planHasFeature("growth", "slack_digest")).toBe(false);
  });

  it("scale plan has slack_digest", () => {
    expect(planHasFeature("scale", "slack_digest")).toBe(true);
  });

  it("scale plan has departments_all", () => {
    expect(planHasFeature("scale", "departments_all")).toBe(true);
  });

  it("enterprise has api_access", () => {
    expect(planHasFeature("enterprise", "api_access")).toBe(true);
  });

  it("unknown tier defaults to free (no features)", () => {
    expect(planHasFeature("unknown", "integrations")).toBe(false);
  });

  // Exhaustive feature check for each plan
  const allFeatures: PlanFeature[] = [
    "departments_all",
    "integrations",
    "semantic_memory",
    "daily_briefings",
    "slack_digest",
    "api_access",
  ];

  it("scale has all features that growth has", () => {
    for (const feature of allFeatures) {
      if (planHasFeature("growth", feature)) {
        expect(planHasFeature("scale", feature)).toBe(true);
      }
    }
  });
});

describe("minimumPlanForFeature", () => {
  it("integrations require at least growth", () => {
    expect(minimumPlanForFeature("integrations")).toBe("growth");
  });

  it("slack_digest requires scale", () => {
    expect(minimumPlanForFeature("slack_digest")).toBe("scale");
  });

  it("departments_all requires scale", () => {
    expect(minimumPlanForFeature("departments_all")).toBe("scale");
  });

  it("api_access requires scale", () => {
    expect(minimumPlanForFeature("api_access")).toBe("scale");
  });

  it("semantic_memory requires growth", () => {
    expect(minimumPlanForFeature("semantic_memory")).toBe("growth");
  });
});
