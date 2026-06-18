import { describe, it, expect } from "vitest";
import { END } from "@langchain/langgraph";
import { routeAfterSnapshot, routeAfterAnalysis, routeAfterPriorities } from "./router.ts";
import type { CompanyCycleState } from "./company-state.ts";

function makeState(overrides: Partial<CompanyCycleState> = {}): CompanyCycleState {
  return {
    companyId: "company-1",
    snapshot: null,
    analysis: null,
    priorities: [],
    dispatchResult: null,
    error: null,
    ...overrides,
  };
}

describe("routeAfterSnapshot", () => {
  it("routes to analysis when company has active goal", () => {
    const state = makeState({
      snapshot: {
        hasActiveGoal: true,
        goalTitle: "Reach $10k MRR",
        goalUnit: "usd",
        targetValue: 10_000,
        currentValue: 3_000,
        deadlineDate: "2026-12-31",
        progressPct: 30,
        latestMrr: 3_000,
        activeCustomers: 15,
        aiCostUsdToday: 2.5,
        tasksRunToday: 8,
        deptStatuses: [],
        recentDecisions: [],
      },
    });
    expect(routeAfterSnapshot(state)).toBe("analyzeCompany");
  });

  it("routes to dispatchTasks when no active goal (skip analysis)", () => {
    const state = makeState({
      snapshot: {
        hasActiveGoal: false,
        goalTitle: "",
        goalUnit: "",
        targetValue: 0,
        currentValue: 0,
        deadlineDate: "",
        progressPct: 0,
        latestMrr: 0,
        activeCustomers: 0,
        aiCostUsdToday: 0,
        tasksRunToday: 0,
        deptStatuses: [],
        recentDecisions: [],
      },
    });
    expect(routeAfterSnapshot(state)).toBe("dispatchTasks");
  });

  it("routes to END on error", () => {
    const state = makeState({ error: "DB connection failed" });
    expect(routeAfterSnapshot(state)).toBe(END);
  });
});

describe("routeAfterAnalysis", () => {
  it("routes to priorities on success", () => {
    const state = makeState({
      analysis: {
        situationSummary: "Growing steadily",
        isOnTrack: true,
        topConstraint: "Lead volume",
        shouldPivot: false,
        pivotReason: "",
        confidence: 0.8,
      },
    });
    expect(routeAfterAnalysis(state)).toBe("generatePriorities");
  });

  it("routes to END on error", () => {
    const state = makeState({ error: "LLM timeout" });
    expect(routeAfterAnalysis(state)).toBe(END);
  });
});

describe("routeAfterPriorities", () => {
  it("routes to dispatch when priorities exist", () => {
    const state = makeState({
      priorities: [
        { department: "sales", focus: "outreach", weeklyTarget: "20 leads" },
      ],
    });
    expect(routeAfterPriorities(state)).toBe("dispatchTasks");
  });

  it("routes to END when priorities are empty", () => {
    const state = makeState({ priorities: [] });
    expect(routeAfterPriorities(state)).toBe(END);
  });

  it("routes to END on error", () => {
    const state = makeState({
      priorities: [{ department: "sales", focus: "x", weeklyTarget: "y" }],
      error: "LLM parse failed",
    });
    expect(routeAfterPriorities(state)).toBe(END);
  });
});
