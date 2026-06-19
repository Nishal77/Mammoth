import { upsertMemory } from "@mammoth/memory-retrieval";
import type { AgentTaskOutput } from "./base-agent.ts";
import { writeLearningSignal } from "./learning-loop.js";

export type OutcomeCaptureOptions = {
  companyId: string;
  department: string;
  taskType: string;
  output: AgentTaskOutput;
  /** Eval gate score when the output passed or failed the eval check (0–1). */
  evalScore?: number;
  /** Whether the eval gate passed. Undefined = eval gate was not run. */
  evalPassed?: boolean;
};

/**
 * Saves significant agent outcomes to company memory as product_lesson entries.
 * Also writes a learning signal so the department's playbook can be refined.
 *
 * Filtered to: Ring 1/2 completions with confidence >= 0.7.
 * Ring 3 = awaiting approval, outcome not certain yet — excluded.
 * Non-blocking: errors are swallowed so they never kill an agent run.
 *
 * @param options - Completed task context and output
 */
export async function captureOutcome(
  options: OutcomeCaptureOptions
): Promise<void> {
  if (options.output.confidence < 0.7) return;
  if (options.output.ringLevel === 3) return;

  const today = new Date().toISOString().slice(0, 10);
  const key = `${options.department}:${options.taskType}:${today}`;

  // Upsert product lesson — feeds back into future prompts via memory-loader.
  await upsertMemory({
    companyId: options.companyId,
    memoryType: "product_lesson",
    key,
    value: options.output.content.slice(0, 2000),
    source: `agent:${options.department}`,
    confidence: options.output.confidence,
  }).catch((err) => {
    console.error("[outcome-capturer] Failed to capture outcome", {
      companyId: options.companyId,
      department: options.department,
      taskType: options.taskType,
      error: err instanceof Error ? err.message : err,
    });
  });

  // Write an eval signal when content went through the eval gate.
  // These signals feed the learning loop alongside founder feedback.
  if (options.evalScore !== undefined && options.evalPassed !== undefined) {
    await writeLearningSignal({
      companyId: options.companyId,
      department: options.department,
      actionType: options.taskType,
      signalType: options.evalPassed ? "eval_pass" : "eval_fail",
      originalContent: options.output.content,
      evalScore: options.evalScore,
    }).catch(() => {});
  }
}
