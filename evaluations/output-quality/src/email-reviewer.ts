import { callLlmJudge } from "./llm-judge.ts";
import type { EvalResult } from "./eval-types.ts";

const SYSTEM_PROMPT = `You are an email deliverability and quality judge for an AI company operating system.
You review outbound sales and marketing emails before they are sent.

Evaluate these dimensions:
1. Spam signals: Subject line trigger words, excessive caps, too many links, deceptive language
2. Personalization: Is the email generic (bad) or personalized to the recipient context?
3. CTA clarity: Is there a single clear call-to-action?
4. Value proposition: Does it lead with value, not features?
5. Length: Is it appropriately concise (< 200 words for cold outreach)?
6. Tone: Professional but human. Not robotic. Not sleazy.

Return JSON:
\`\`\`json
{
  "verdict": "pass" | "fail" | "warn",
  "score": 0-100,
  "findings": [
    { "category": "spam" | "personalization" | "cta" | "value_prop" | "length" | "tone", "description": "specific issue", "severity": "high" | "medium" | "low" }
  ],
  "revisedContent": "improved version if score < 80"
}
\`\`\`

verdict=pass if score >= 75. warn if 55-74. fail if < 55.`;

export type EmailReviewOptions = {
  subject: string;
  body: string;
  recipientContext?: string | undefined;
};

/**
 * Reviews an outbound email for quality, spam signals, and personalization.
 * Block sending on fail, surface warning for human review on warn, auto-approve on pass.
 *
 * @param options - email subject, body, and optional recipient context for personalization check
 */
export async function reviewEmail(options: EmailReviewOptions): Promise<EvalResult> {
  const { subject, body, recipientContext = "" } = options;

  const userMessage = `EMAIL TO REVIEW:

Subject: ${subject}

Body:
${body.slice(0, 3000)}

${recipientContext ? `Recipient context: ${recipientContext.slice(0, 500)}` : ""}

Review this email for deliverability, quality, and effectiveness.`;

  const result = await callLlmJudge({ systemPrompt: SYSTEM_PROMPT, userMessage });

  if (!result) {
    return {
      verdict: "warn",
      score: 70,
      findings: [{ category: "judge_error", description: "Email reviewer did not return a valid response", severity: "low" }],
    };
  }

  return result;
}
