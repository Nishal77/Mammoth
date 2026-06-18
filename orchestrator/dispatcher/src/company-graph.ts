import { StateGraph, START, END } from "@langchain/langgraph";
import { CompanyCycleStateAnnotation } from "./company-state.ts";
import { snapshotNode, analysisNode, prioritiesNode, dispatchNode } from "./nodes/index.ts";
import { routeAfterSnapshot, routeAfterAnalysis, routeAfterPriorities } from "./router.ts";

/**
 * CEO Brain planning graph.
 *
 * Each cycle follows: snapshot → analysis → priorities → dispatch.
 * Each node is a focused, testable function. The graph adds:
 *   - Conditional routing (skip analysis when no active goal)
 *   - Error propagation (any node can set error → routes to END)
 *   - Clear observability (which phase is CEO Brain in?)
 *
 * Flow:
 *   START
 *     → snapshot (load DB state — no LLM, ~50ms)
 *     → analysis (Claude Sonnet — is we on track? pivot needed?)
 *     → priorities (Claude Sonnet — which depts need work this cycle?)
 *     → dispatch (write to DB + queue BullMQ jobs)
 *     → END
 *
 * Pivot handling: analysisNode sets shouldPivot in state → prioritiesNode
 * reads it and assigns all-hands priorities toward the new direction.
 */
export const companyCycleGraph = new StateGraph(CompanyCycleStateAnnotation)
  .addNode("loadSnapshot", snapshotNode)
  .addNode("analyzeCompany", analysisNode)
  .addNode("generatePriorities", prioritiesNode)
  .addNode("dispatchTasks", dispatchNode)
  .addEdge(START, "loadSnapshot")
  .addConditionalEdges("loadSnapshot", routeAfterSnapshot, {
    analyzeCompany: "analyzeCompany",
    dispatchTasks: "dispatchTasks",
    [END]: END,
  })
  .addConditionalEdges("analyzeCompany", routeAfterAnalysis, {
    generatePriorities: "generatePriorities",
    [END]: END,
  })
  .addConditionalEdges("generatePriorities", routeAfterPriorities, {
    dispatchTasks: "dispatchTasks",
    [END]: END,
  })
  .addEdge("dispatchTasks", END)
  .compile();
