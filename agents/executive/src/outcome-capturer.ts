import { upsertMemory } from "../memory/memory-writer.ts";
import type { AgentTaskOutput } from "../base/base-agent.ts";

export type OutcomeCaptureOptions = {
  companyId: string;
  department: string;
  taskType: string;
  output: AgentTaskOutput;
};

/**
 * Saves significant agent outcomes to company memory as product_lesson entries.
 * These feed back into future agent prompts via the memory-loader.
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
}
