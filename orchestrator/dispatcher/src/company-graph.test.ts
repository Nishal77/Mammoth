import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the CEO Brain planning graph.
 * Each node is mocked so tests run without DB/Redis/LLM.
 * We verify the graph routes correctly and passes state between nodes.
 */

const { mockSnapshotNode, mockAnalysisNode, mockPrioritiesNode, mockDispatchNode } = vi.hoisted(() => ({
  mockSnapshotNode: vi.fn(),
  mockAnalysisNode: vi.fn(),
  mockPrioritiesNode: vi.fn(),
  mockDispatchNode: vi.fn(),
}));

vi.mock("./nodes/snapshot-node.ts", () => ({ snapshotNode: mockSnapshotNode }));
vi.mock("./nodes/analysis-node.ts", () => ({ analysisNode: mockAnalysisNode }));
vi.mock("./nodes/priorities-node.ts", () => ({ prioritiesNode: mockPrioritiesNode }));
vi.mock("./nodes/dispatch-node.ts", () => ({ dispatchNode: mockDispatchNode }));
vi.mock("./nodes/index.ts", () => ({
  snapshotNode: mockSnapshotNode,
  analysisNode: mockAnalysisNode,
  prioritiesNode: mockPrioritiesNode,
  dispatchNode: mockDispatchNode,
}));

import { companyCycleGraph } from "./company-graph.ts";

const ACTIVE_GOAL_SNAPSHOT = {
  hasActiveGoal: true,
  goalTitle: "Reach $10k MRR",
  goalUnit: "usd",
  targetValue: 10_000,
  currentValue: 4_000,
  deadlineDate: "2026-12-31",
  progressPct: 40,
  latestMrr: 4_000,
  activeCustomers: 20,
  aiCostUsdToday: 1.5,
  tasksRunToday: 5,
  deptStatuses: [{ name: "sales", status: "active", lastRunAt: null }],
  recentDecisions: [],
};

const ANALYSIS_ON_TRACK = {
  situationSummary: "Company is growing well.",
  isOnTrack: true,
  topConstraint: "Lead volume",
  shouldPivot: false,
  pivotReason: "",
  confidence: 0.85,
};

const PRIORITIES = [
  { department: "sales", focus: "Increase outreach volume", weeklyTarget: "20 qualified leads" },
  { department: "marketing", focus: "Grow LinkedIn presence", weeklyTarget: "3 posts" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("companyCycleGraph — happy path", () => {
  it("runs all 4 nodes in order when company has an active goal", async () => {
    mockSnapshotNode.mockResolvedValueOnce({ snapshot: ACTIVE_GOAL_SNAPSHOT });
    mockAnalysisNode.mockResolvedValueOnce({ analysis: ANALYSIS_ON_TRACK });
    mockPrioritiesNode.mockResolvedValueOnce({ priorities: PRIORITIES });
    mockDispatchNode.mockResolvedValueOnce({
      dispatchResult: { dispatched: 2, agentRunId: "run-abc" },
    });

    const result = await companyCycleGraph.invoke({ companyId: "company-1" });

    expect(mockSnapshotNode).toHaveBeenCalledOnce();
    expect(mockAnalysisNode).toHaveBeenCalledOnce();
    expect(mockPrioritiesNode).toHaveBeenCalledOnce();
    expect(mockDispatchNode).toHaveBeenCalledOnce();

    expect(result.dispatchResult).toEqual({ dispatched: 2, agentRunId: "run-abc" });
    expect(result.priorities).toEqual(PRIORITIES);
  });
});

describe("companyCycleGraph — no active goal", () => {
  it("skips analysis and priorities, goes straight to dispatch", async () => {
    const noGoalSnapshot = { ...ACTIVE_GOAL_SNAPSHOT, hasActiveGoal: false };
    mockSnapshotNode.mockResolvedValueOnce({ snapshot: noGoalSnapshot });
    mockDispatchNode.mockResolvedValueOnce({
      dispatchResult: { dispatched: 0, agentRunId: "" },
    });

    await companyCycleGraph.invoke({ companyId: "company-1" });

    expect(mockSnapshotNode).toHaveBeenCalledOnce();
    expect(mockAnalysisNode).not.toHaveBeenCalled();
    expect(mockPrioritiesNode).not.toHaveBeenCalled();
    expect(mockDispatchNode).toHaveBeenCalledOnce();
  });
});

describe("companyCycleGraph — error handling", () => {
  it("stops at END when snapshot sets error", async () => {
    mockSnapshotNode.mockResolvedValueOnce({ error: "DB connection failed" });

    const result = await companyCycleGraph.invoke({ companyId: "company-1" });

    expect(mockAnalysisNode).not.toHaveBeenCalled();
    expect(mockDispatchNode).not.toHaveBeenCalled();
    expect(result.error).toBe("DB connection failed");
  });

  it("stops at END when priorities are empty", async () => {
    mockSnapshotNode.mockResolvedValueOnce({ snapshot: ACTIVE_GOAL_SNAPSHOT });
    mockAnalysisNode.mockResolvedValueOnce({ analysis: ANALYSIS_ON_TRACK });
    mockPrioritiesNode.mockResolvedValueOnce({ priorities: [] });

    await companyCycleGraph.invoke({ companyId: "company-1" });

    expect(mockDispatchNode).not.toHaveBeenCalled();
  });
});
