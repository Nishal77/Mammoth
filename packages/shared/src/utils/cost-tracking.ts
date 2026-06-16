const MODEL_COST_PER_MILLION_TOKENS = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
} as const;

export type SupportedModel = keyof typeof MODEL_COST_PER_MILLION_TOKENS;

/**
 * Calculates USD cost for a single LLM call.
 * Used by agent workers before and after each invocation.
 */
export function calculateLlmCostUsd(
  model: SupportedModel,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = MODEL_COST_PER_MILLION_TOKENS[model];
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export function formatCostUsd(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}
