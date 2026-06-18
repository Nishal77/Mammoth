import { callLlmJudge } from "./llm-judge.ts";
import type { EvalResult } from "./eval-types.ts";

const SYSTEM_PROMPT = `You are a brand voice compliance judge for an AI company operating system.
Your job is to verify that generated content matches the company's brand voice guidelines.

Evaluate:
1. Tone: Does it match the specified tone (professional, casual, bold, etc.)?
2. Vocabulary: Are there any banned words or phrases from the guidelines?
3. Messaging: Does it align with the brand's positioning and values?
4. Length: Is it appropriate for the content type?

Return JSON:
\`\`\`json
{
  "verdict": "pass" | "fail" | "warn",
  "score": 0-100,
  "findings": [
    { "category": "tone" | "vocabulary" | "messaging" | "length", "description": "specific issue", "severity": "high" | "medium" | "low" }
  ],
  "revisedContent": "optional improved version if verdict is fail or warn"
}
\`\`\`

verdict=pass if score >= 75. warn if 55-74. fail if < 55.`;

export type BrandCheckOptions = {
  content: string;
  brandVoiceGuidelines: string;
  contentType: string;
};

/**
 * Verifies that content matches the company's brand voice guidelines.
 * Returns optional revisedContent if the content is close but needs fixes.
 *
 * @param options - content, brand guidelines loaded from company memory, content type
 */
export async function checkBrandVoice(options: BrandCheckOptions): Promise<EvalResult> {
  const { content, brandVoiceGuidelines, contentType } = options;

  const userMessage = `BRAND VOICE GUIDELINES:
<brand_guidelines>
${brandVoiceGuidelines.slice(0, 3000)}
</brand_guidelines>

CONTENT TYPE: ${contentType}

CONTENT TO REVIEW:
<content>
${content.slice(0, 3000)}
</content>

Evaluate whether this content matches the brand voice guidelines.`;

  const result = await callLlmJudge({ systemPrompt: SYSTEM_PROMPT, userMessage });

  if (!result) {
    return {
      verdict: "warn",
      score: 70,
      findings: [{ category: "judge_error", description: "Brand checker did not return a valid response", severity: "low" }],
    };
  }

  return result;
}
