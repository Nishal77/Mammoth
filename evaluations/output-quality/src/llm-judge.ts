import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

const JUDGE_MODEL = "claude-haiku-4-5-20251001";

const JudgeResponseSchema = z.object({
  verdict: z.enum(["pass", "fail", "warn"]),
  score: z.number().min(0).max(100),
  findings: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
      severity: z.enum(["low", "medium", "high"]),
    })
  ),
  revisedContent: z.string().optional(),
});

export type JudgePrompt = {
  systemPrompt: string;
  userMessage: string;
};

/**
 * Calls the LLM judge with the given prompt and parses the structured response.
 * Uses Haiku for low cost — evaluations run on every agent output.
 * Returns null on JSON parse failure so callers can degrade gracefully.
 */
export async function callLlmJudge(
  prompt: JudgePrompt
): Promise<z.infer<typeof JudgeResponseSchema> | null> {
  try {
    const response = await anthropic.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 2048,
      system: prompt.systemPrompt,
      messages: [{ role: "user", content: prompt.userMessage }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/({[\s\S]*})/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[1]!);
    return JudgeResponseSchema.parse(parsed);
  } catch {
    return null;
  }
}
