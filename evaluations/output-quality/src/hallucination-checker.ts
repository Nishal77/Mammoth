import { callLlmJudge } from "./llm-judge.ts";
import type { EvalResult } from "./eval-types.ts";

const SYSTEM_PROMPT = `You are a hallucination detection judge for an AI company operating system.
Your job is to verify that an AI agent's output does not contain factual claims that contradict or are absent from the provided source context.

Rules:
- A claim is a hallucination if it asserts a specific fact (number, name, date, feature, price, policy) NOT present in the context.
- Generic statements and obvious facts (e.g. "email is a communication tool") are NOT hallucinations.
- Reasonable inferences from context are NOT hallucinations.
- Only flag specific, verifiable claims that have NO grounding in the context.

Return JSON:
\`\`\`json
{
  "verdict": "pass" | "fail" | "warn",
  "score": 0-100,
  "findings": [
    { "category": "hallucination", "description": "exact quote of the ungrounded claim", "severity": "high" | "medium" | "low" }
  ]
}
\`\`\`

verdict=pass if score >= 80, warn if 60-79, fail if < 60.`;

export type HallucinationCheckOptions = {
  content: string;
  sourceContext: string;
};

/**
 * Checks whether the content contains claims not grounded in the provided source context.
 * Used before any content is published to ensure factual accuracy.
 *
 * @param options - content to check and the source context it should be grounded in
 */
export async function checkHallucination(options: HallucinationCheckOptions): Promise<EvalResult> {
  const { content, sourceContext } = options;

  const userMessage = `SOURCE CONTEXT:
<context>
${sourceContext.slice(0, 6000)}
</context>

AGENT OUTPUT TO CHECK:
<output>
${content.slice(0, 3000)}
</output>

Identify any factual claims in the output that are not grounded in the source context.`;

  const result = await callLlmJudge({ systemPrompt: SYSTEM_PROMPT, userMessage });

  if (!result) {
    // Degrade gracefully — if judge fails, warn but don't block
    return {
      verdict: "warn",
      score: 70,
      findings: [{ category: "judge_error", description: "Hallucination checker did not return a valid response", severity: "low" }],
    };
  }

  return result;
}
