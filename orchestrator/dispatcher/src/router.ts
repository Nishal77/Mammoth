import { END } from "@langchain/langgraph";
import type { CompanyCycleState } from "./company-state.ts";

/**
 * Routes from snapshotNode to the next step.
 * If no active goal exists, skip analysis + priorities — go straight to dispatch
 * so CEO Brain can at least record the "no goal" state.
 */
export function routeAfterSnapshot(state: CompanyCycleState): string {
  if (state.error) return END;
  if (!state.snapshot?.hasActiveGoal) return "dispatchTasks";
  return "analyzeCompany";
}

/**
 * Routes from analysisNode.
 * Always proceeds to priorities — analysis never terminates the graph early.
 */
export function routeAfterAnalysis(state: CompanyCycleState): string {
  if (state.error) return END;
  return "generatePriorities";
}

/**
 * Routes from prioritiesNode.
 * If priorities are empty (model produced nothing useful), log and end.
 * Otherwise proceed to dispatch.
 */
export function routeAfterPriorities(state: CompanyCycleState): string {
  if (state.error) return END;
  if (state.priorities.length === 0) return END;
  return "dispatchTasks";
}
