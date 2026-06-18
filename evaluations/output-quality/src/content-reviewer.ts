import { callLlmJudge } from "./llm-judge.ts";
import type { EvalResult, ContentType } from "./eval-types.ts";

const SYSTEM_PROMPTS: Record<ContentType, string> = {
  linkedin_post: `You are a LinkedIn content quality judge.
Evaluate:
1. Hook: Does the first line stop the scroll?
2. Value: Does it teach, inspire, or entertain — not just promote?
3. Length: 150-300 words is ideal for LinkedIn
4. Formatting: Short paragraphs, line breaks for readability. No walls of text.
5. CTA: Optional but if present, is it natural?
6. Authenticity: Does it sound human or like AI slop?
7. No hashtag spam (max 3 relevant hashtags)`,

  blog_post: `You are a blog content quality judge.
Evaluate:
1. SEO: Does it have a clear H1, natural keyword usage?
2. Structure: Clear intro, body with subheadings, actionable conclusion
3. Originality: Does it add new perspective vs. generic content?
4. Readability: Short sentences, active voice, clear examples
5. Depth: Does it actually cover the topic vs. surface-level fluff?`,

  tweet: `You are a Twitter/X content quality judge.
Evaluate:
1. Length: Under 280 characters
2. Hook: First 5 words must grab attention
3. Clarity: One clear point per tweet
4. No excessive hashtags (max 1-2)
5. No cringe engagement bait`,

  slack_message: `You are a Slack message quality judge for internal team communications.
Evaluate:
1. Clarity: Is the message clear and actionable?
2. Tone: Professional and respectful
3. Length: Appropriate — not a novel, not a fragment
4. Urgency: Is priority level communicated appropriately?`,

  email: `You are an email quality judge. Evaluate for clarity, tone, and professionalism.`,
  generic: `You are a content quality judge. Evaluate for clarity, accuracy, and appropriateness.`,
};

const VERDICT_FORMAT = `
Return JSON:
\`\`\`json
{
  "verdict": "pass" | "fail" | "warn",
  "score": 0-100,
  "findings": [
    { "category": "string", "description": "specific issue", "severity": "high" | "medium" | "low" }
  ],
  "revisedContent": "improved version if score < 80"
}
\`\`\`
verdict=pass if score >= 75. warn if 55-74. fail if < 55.`;

export type ContentReviewOptions = {
  content: string;
  contentType: ContentType;
  topic?: string | undefined;
};

/**
 * Reviews social and blog content before publishing.
 * Different system prompts enforce platform-specific best practices.
 * Agents must pass review before any external content is published.
 *
 * @param options - content, content type, optional topic for context
 */
export async function reviewContent(options: ContentReviewOptions): Promise<EvalResult> {
  const { content, contentType, topic = "" } = options;

  const basePrompt = SYSTEM_PROMPTS[contentType] ?? SYSTEM_PROMPTS.generic;
  const systemPrompt = `${basePrompt}\n${VERDICT_FORMAT}`;

  const userMessage = `${topic ? `Topic: ${topic}\n\n` : ""}CONTENT TO REVIEW:\n${content.slice(0, 3000)}`;

  const result = await callLlmJudge({ systemPrompt, userMessage });

  if (!result) {
    return {
      verdict: "warn",
      score: 70,
      findings: [{ category: "judge_error", description: "Content reviewer did not return a valid response", severity: "low" }],
    };
  }

  return result;
}
