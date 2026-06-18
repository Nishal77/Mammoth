import { Annotation } from "@langchain/langgraph";
import type { DepartmentPriority } from "./department-dispatcher.ts";

export type CompanySnapshot = {
  goalTitle: string;
  goalUnit: string;
  targetValue: number;
  currentValue: number;
  deadlineDate: string;
  progressPct: number;
  latestMrr: number;
  activeCustomers: number;
  aiCostUsdToday: number;
  tasksRunToday: number;
  deptStatuses: { name: string; status: string; lastRunAt: string | null }[];
  recentDecisions: { title: string; decision: string }[];
  hasActiveGoal: boolean;
};

export type CeoAnalysis = {
  situationSummary: string;
  isOnTrack: boolean;
  topConstraint: string;
  shouldPivot: boolean;
  pivotReason: string;
  confidence: number;
};

export type DispatchResult = {
  dispatched: number;
  agentRunId: string;
};

/**
 * State for the CEO Brain planning graph.
 * Each field uses a reducer so partial updates merge cleanly.
 * Nodes return partial state — only the fields they compute.
 */
export const CompanyCycleStateAnnotation = Annotation.Root({
  companyId: Annotation<string>(),

  // Populated by snapshotNode
  snapshot: Annotation<CompanySnapshot | null>({
    reducer: (_, update) => update ?? null,
    default: () => null,
  }),

  // Populated by analysisNode
  analysis: Annotation<CeoAnalysis | null>({
    reducer: (_, update) => update ?? null,
    default: () => null,
  }),

  // Populated by prioritiesNode
  priorities: Annotation<DepartmentPriority[]>({
    reducer: (_, update) => update ?? [],
    default: () => [],
  }),

  // Populated by dispatchNode
  dispatchResult: Annotation<DispatchResult | null>({
    reducer: (_, update) => update ?? null,
    default: () => null,
  }),

  // Set by any node on unrecoverable error — graph routes to END
  error: Annotation<string | null>({
    reducer: (_, update) => update ?? null,
    default: () => null,
  }),
});

export type CompanyCycleState = typeof CompanyCycleStateAnnotation.State;
