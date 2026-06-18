export type EvalVerdict = "pass" | "fail" | "warn";

export type EvalFinding = {
  category: string;
  description: string;
  severity: "low" | "medium" | "high";
};

export type EvalResult = {
  verdict: EvalVerdict;
  score: number;
  findings: EvalFinding[];
  revisedContent?: string | undefined;
};

export type ContentType = "email" | "linkedin_post" | "blog_post" | "tweet" | "slack_message" | "generic";
