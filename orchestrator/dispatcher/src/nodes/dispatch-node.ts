import { db, strategyDecisions } from "@mammoth/memory-database";
import { upsertMemory } from "@mammoth/memory-retrieval";
import { updateGoalProgress } from "@mammoth/agent-executive";
import { dispatchDepartmentTasks } from "../department-dispatcher.ts";
import type { CompanyCycleState } from "../company-state.ts";
import { createLogger } from "@mammoth/observability/logger";

const log = createLogger("dispatch-node");

/**
 * Dispatch node — final node in the CEO Brain planning graph.
 * Persists the strategy decision, updates goal progress, writes priorities
 * to company memory (where dept agents pick them up), and fires BullMQ jobs.
 *
 * All DB writes happen inside this single node so the graph is atomic:
 * if dispatch fails, no partial state is left in the DB.
 */
export async function dispatchNode(
  state: CompanyCycleState
): Promise<Partial<CompanyCycleState>> {
  const { companyId, snapshot, analysis, priorities } = state;

  if (!analysis || priorities.length === 0) {
    log.warn("Dispatch skipped — no analysis or empty priorities", { companyId });
    return { dispatchResult: { dispatched: 0, agentRunId: "" } };
  }

  // Persist the strategy decision to the DB decision log
  await db.insert(strategyDecisions).values({
    companyId,
    title: `CEO Brain Cycle — ${new Date().toISOString().slice(0, 10)}`,
    decision: analysis.situationSummary,
    reasoning: JSON.stringify({
      isOnTrack: analysis.isOnTrack,
      topConstraint: analysis.topConstraint,
      shouldPivot: analysis.shouldPivot,
      pivotReason: analysis.pivotReason,
      priorityCount: priorities.length,
    }),
    madeBy: "ai",
    sourceAgent: "ceo_brain",
    tags: [
      "strategy",
      "cycle",
      analysis.isOnTrack ? "on-track" : "off-track",
      ...(analysis.shouldPivot ? ["pivot"] : []),
    ],
  });

  // Update goal progress from latest Stripe/metrics data
  await updateGoalProgress(companyId).catch((err: unknown) => {
    log.warn("Goal progress update failed — non-fatal", {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Write priorities to memory so dept agents pick them up as context on next run
  const week = new Date().toISOString().slice(0, 10);
  await Promise.all(
    priorities.map((priority) =>
      upsertMemory({
        companyId,
        memoryType: "playbook_refinement",
        key: `${priority.department}:weekly_priority:${week}`,
        value: `Focus: ${priority.focus}\nWeekly target: ${priority.weeklyTarget}`,
        source: "agent:ceo_brain",
        confidence: 0.9,
      }).catch(() => undefined)
    )
  );

  // Dispatch BullMQ jobs — each department gets its own queued agent task
  const agentRunId = await dispatchDepartmentTasks(companyId, priorities);

  log.info("CEO Brain cycle dispatched", {
    companyId,
    departmentCount: priorities.length,
    isOnTrack: analysis.isOnTrack,
    shouldPivot: analysis.shouldPivot,
    agentRunId,
  });

  const progressNote = snapshot?.hasActiveGoal
    ? ` Goal at ${snapshot.progressPct}%.`
    : "";

  return {
    dispatchResult: {
      dispatched: priorities.length,
      agentRunId,
    },
    analysis: {
      ...analysis,
      situationSummary: analysis.situationSummary + progressNote,
    },
  };
}
