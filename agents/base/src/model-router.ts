import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { calculateLlmCostUsd } from "@mammoth/shared/utils";
import { AgentCostLimitError } from "@mammoth/shared/errors";
import { db, metricsDaily } from "@mammoth/memory-database";
import { eq, and, sql } from "drizzle-orm";

export const MODELS = {
  SONNET: "claude-sonnet-4-6",
  HAIKU: "claude-haiku-4-5-20251001",
  GPT4O_MINI: "gpt-4o-mini",
  EMBEDDING: "text-embedding-3-small",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export type ModelCallOptions = {
  model: ModelId;
  systemPrompt: string;
  messages: Anthropic.MessageParam[] | OpenAI.Chat.ChatCompletionMessageParam[];
  maxTokens?: number;
  companyId: string;
};

export type ModelCallResult = {
  content: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: ModelId;
  durationMs: number;
};

const MAX_AGENT_COST_PER_DAY_USD = Number(
  process.env["MAX_AGENT_COST_PER_DAY_USD"] ?? 50
);

const anthropic = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"],
});

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

/**
 * Checks today's AI spend for this company against the daily hard cap.
 * Throws AgentCostLimitError if cap is reached — no override exists.
 */
async function enforceCostedCap(companyId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const row = await db.query.metricsDaily.findFirst({
    where: and(
      eq(metricsDaily.companyId, companyId),
      eq(metricsDaily.date, today)
    ),
    columns: { aiCostUsd: true },
  });

  const todaySpend = Number(row?.aiCostUsd ?? 0);
  if (todaySpend >= MAX_AGENT_COST_PER_DAY_USD) {
    throw new AgentCostLimitError(companyId);
  }
}

async function recordCost(companyId: string, costUsd: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await db
    .insert(metricsDaily)
    .values({
      companyId,
      date: today,
      aiCostUsd: costUsd.toString(),
      tasksRun: 0,
    })
    .onConflictDoUpdate({
      target: [metricsDaily.companyId, metricsDaily.date],
      set: {
        aiCostUsd: sql`${metricsDaily.aiCostUsd} + ${costUsd}`,
        tasksRun: sql`${metricsDaily.tasksRun} + 1`,
      },
    });
}

/**
 * Routes an LLM call to the correct provider and model.
 * Checks cost cap before every call. Records spend after.
 *
 * @param options - Model, messages, and company context
 * @returns Structured result with content, tokens, and cost
 */
/**
 * Routes an LLM call to the correct provider and model.
 * Checks cost cap before every call. Records spend and emits a structured LLM
 * trace log (Langfuse-equivalent — queryable via log aggregation).
 * durationMs is always populated so callers can store it in taskRuns.
 *
 * @param options - Model, messages, and company context
 * @returns Structured result with content, tokens, cost, and duration
 */
export async function callModel(
  options: ModelCallOptions
): Promise<ModelCallResult> {
  await enforceCostedCap(options.companyId);

  const maxTokens = options.maxTokens ?? 4096;
  const startedAt = Date.now();

  if (
    options.model === MODELS.SONNET ||
    options.model === MODELS.HAIKU
  ) {
    const messages = options.messages as Anthropic.MessageParam[];

    const response = await anthropic.messages.create({
      model: options.model,
      max_tokens: maxTokens,
      system: options.systemPrompt,
      messages,
    });

    const durationMs = Date.now() - startedAt;
    const promptTokens = response.usage.input_tokens;
    const completionTokens = response.usage.output_tokens;
    const costUsd = calculateLlmCostUsd(options.model, promptTokens, completionTokens);

    await recordCost(options.companyId, costUsd);

    const content =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    // Structured LLM trace — aggregated by log collector (Grafana Loki / CloudWatch)
    // Replaces Langfuse for environments where a separate SaaS is not desired.
    console.log(JSON.stringify({
      event: "llm.call",
      model: options.model,
      companyId: options.companyId,
      promptTokens,
      completionTokens,
      costUsd: costUsd.toFixed(6),
      durationMs,
      stopReason: response.stop_reason,
    }));

    return { content, promptTokens, completionTokens, costUsd, model: options.model, durationMs };
  }

  if (options.model === MODELS.GPT4O_MINI) {
    const messages =
      options.messages as OpenAI.Chat.ChatCompletionMessageParam[];

    const response = await openai.chat.completions.create({
      model: options.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: options.systemPrompt },
        ...messages,
      ],
    });

    const durationMs = Date.now() - startedAt;
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const costUsd = calculateLlmCostUsd(options.model, promptTokens, completionTokens);

    await recordCost(options.companyId, costUsd);

    const content = response.choices[0]?.message.content ?? "";

    console.log(JSON.stringify({
      event: "llm.call",
      model: options.model,
      companyId: options.companyId,
      promptTokens,
      completionTokens,
      costUsd: costUsd.toFixed(6),
      durationMs,
      stopReason: response.choices[0]?.finish_reason,
    }));

    return { content, promptTokens, completionTokens, costUsd, model: options.model, durationMs };
  }

  throw new Error(`Unsupported model: ${options.model}`);
}
