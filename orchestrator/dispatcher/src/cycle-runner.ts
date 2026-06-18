import { companyCycleGraph } from "./company-graph.ts";
import type { CompanyCycleState } from "./company-state.ts";
import { createLogger } from "@mammoth/observability/logger";

const log = createLogger("cycle-runner");

export type CycleRunResult = {
  companyId: string;
  dispatched: number;
  isOnTrack: boolean;
  shouldPivot: boolean;
  agentRunId: string;
  durationMs: number;
  error: string | null;
};

/**
 * Runs one CEO Brain planning cycle for a company.
 * Invokes the LangGraph StateGraph: snapshot → analysis → priorities → dispatch.
 * Returns a structured result for logging and monitoring.
 *
 * Called by the scheduler worker every 6 hours per active company.
 * Also callable ad-hoc from the API for on-demand CEO Brain runs.
 *
 * @param companyId - The company to run the cycle for
 */
export async function runCompanyCycle(companyId: string): Promise<CycleRunResult> {
  const startedAt = Date.now();

  log.info("CEO Brain cycle starting", { companyId });

  const initialState: Partial<CompanyCycleState> = {
    companyId,
    snapshot: null,
    analysis: null,
    priorities: [],
    dispatchResult: null,
    error: null,
  };

  let finalState: CompanyCycleState;

  try {
    finalState = await companyCycleGraph.invoke(initialState) as CompanyCycleState;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.errorWithStack("CEO Brain cycle graph error", err as Error, { companyId });
    return {
      companyId,
      dispatched: 0,
      isOnTrack: false,
      shouldPivot: false,
      agentRunId: "",
      durationMs: Date.now() - startedAt,
      error: errorMsg,
    };
  }

  const durationMs = Date.now() - startedAt;

  if (finalState.error) {
    log.warn("CEO Brain cycle ended with error", { companyId, error: finalState.error });
    return {
      companyId,
      dispatched: 0,
      isOnTrack: false,
      shouldPivot: false,
      agentRunId: "",
      durationMs,
      error: finalState.error,
    };
  }

  const result: CycleRunResult = {
    companyId,
    dispatched: finalState.dispatchResult?.dispatched ?? 0,
    isOnTrack: finalState.analysis?.isOnTrack ?? false,
    shouldPivot: finalState.analysis?.shouldPivot ?? false,
    agentRunId: finalState.dispatchResult?.agentRunId ?? "",
    durationMs,
    error: null,
  };

  log.info("CEO Brain cycle complete", {
    companyId,
    dispatched: result.dispatched,
    isOnTrack: result.isOnTrack,
    shouldPivot: result.shouldPivot,
    durationMs,
  });

  return result;
}
