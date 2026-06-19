const MODEL_COST_PER_MILLION_TOKENS = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
} as const;

// Anthropic prompt cache multipliers (applied to the model's base input price).
// Cache write = 1.25x — pay a premium to prime the cache.
// Cache read  = 0.10x — 90% cheaper on subsequent hits within the 5-min TTL.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER  = 0.10;

export type SupportedModel = keyof typeof MODEL_COST_PER_MILLION_TOKENS;

export type LlmTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  /** Tokens written to the prompt cache this call (priced at 1.25x input). */
  cacheCreationTokens?: number;
  /** Tokens read from the prompt cache this call (priced at 0.1x input). */
  cacheReadTokens?: number;
};

/**
 * Calculates USD cost for a single LLM call, including prompt-cache tokens.
 * Cache-read tokens are charged at 10% of normal input price — the dominant
 * saving when the same system prompt + context is reused across runs.
 *
 * @param model  - Model identifier
 * @param usage  - Token breakdown including optional cache token counts
 */
export function calculateLlmCostUsd(
  model: SupportedModel,
  promptTokens: number,
  completionTokens: number,
  usage?: Pick<LlmTokenUsage, "cacheCreationTokens" | "cacheReadTokens">
): number {
  const pricing = MODEL_COST_PER_MILLION_TOKENS[model];
  const perToken = pricing.input / 1_000_000;

  const cacheWrite = usage?.cacheCreationTokens ?? 0;
  const cacheRead  = usage?.cacheReadTokens     ?? 0;
  const regularInput = promptTokens - cacheWrite - cacheRead;

  const inputCost =
    (regularInput  * perToken)                         +
    (cacheWrite    * perToken * CACHE_WRITE_MULTIPLIER) +
    (cacheRead     * perToken * CACHE_READ_MULTIPLIER);

  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export function formatCostUsd(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}
