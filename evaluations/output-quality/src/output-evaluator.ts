import { checkHallucination } from "./hallucination-checker.ts";
import { checkBrandVoice } from "./brand-checker.ts";
import { reviewEmail } from "./email-reviewer.ts";
import { reviewContent } from "./content-reviewer.ts";
import type { EvalResult, EvalVerdict, ContentType } from "./eval-types.ts";

export type OutputEvalOptions = {
  companyId: string;
  contentType: ContentType;
  content: string;
  sourceContext: string;
  brandVoiceGuidelines: string;
  /** Extra fields for email review */
  emailSubject?: string;
  recipientContext?: string;
  topic?: string;
};

export type OutputEvalSummary = {
  overallVerdict: EvalVerdict;
  overallScore: number;
  hallucinationResult: EvalResult;
  brandResult: EvalResult;
  contentResult: EvalResult;
  /** Best revised content from whichever reviewer produced one */
  revisedContent?: string;
  /** True when any single check returned fail */
  blocked: boolean;
};

/**
 * Orchestrates all output quality checks before an agent publishes content.
 * Runs hallucination, brand voice, and content-type checks in parallel.
 * overall verdict = worst of the three. blocked = true on any fail.
 *
 * Agents call this before dispatching any external-facing action.
 */
export async function evaluateOutput(options: OutputEvalOptions): Promise<OutputEvalSummary> {
  const {
    content,
    contentType,
    sourceContext,
    brandVoiceGuidelines,
    emailSubject,
    recipientContext,
    topic,
  } = options;

  const [hallucinationResult, brandResult, contentResult] = await Promise.all([
    checkHallucination({ content, sourceContext }),
    checkBrandVoice({ content, brandVoiceGuidelines, contentType }),
    contentType === "email" && emailSubject
      ? reviewEmail({ subject: emailSubject, body: content, recipientContext })
      : reviewContent({ content, contentType, topic }),
  ]);

  const scores = [hallucinationResult.score, brandResult.score, contentResult.score];
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const verdicts = [hallucinationResult.verdict, brandResult.verdict, contentResult.verdict];
  const blocked = verdicts.includes("fail");
  const overallVerdict: EvalVerdict = blocked
    ? "fail"
    : verdicts.includes("warn")
    ? "warn"
    : "pass";

  const revisedContent =
    hallucinationResult.revisedContent ??
    brandResult.revisedContent ??
    contentResult.revisedContent;

  return {
    overallVerdict,
    overallScore,
    hallucinationResult,
    brandResult,
    contentResult,
    ...(revisedContent !== undefined ? { revisedContent } : {}),
    blocked,
  };
}
