import { z } from "zod";
import { db, jobPostings, candidates } from "@mammoth/memory-database";
import { eq } from "drizzle-orm";
import { BaseAgent } from "@mammoth/agent-base";
import { MODELS } from "@mammoth/agent-base";
import type { AgentTaskInput, AgentTaskOutput } from "@mammoth/agent-base";

const JobDescriptionSchema = z.object({
  title: z.string(),
  department: z.string(),
  seniority: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string()),
  mustHaveRequirements: z.array(z.string()),
  niceToHaveRequirements: z.array(z.string()),
  compensationRange: z.string().optional(),
  workStyle: z.enum(["remote", "hybrid", "onsite"]),
});

const CandidateScreeningSchema = z.object({
  fitScore: z.number().int().min(0).max(100),
  mustHavesMet: z.array(z.string()),
  mustHavesMissing: z.array(z.string()),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  recommendation: z.enum(["advance", "hold", "reject"]),
  reasoningSummary: z.string(),
  suggestedInterviewQuestions: z.array(z.string()),
});

type HrTaskType = "create_job_description" | "screen_candidate" | "draft_offer_letter";

/**
 * HR Agent — job descriptions, candidate screening, offer letters.
 * Job postings are Ring 2 (4h veto). Offer letters are Ring 3 (must explicitly approve).
 * Candidate screening is Ring 1 — internal analysis only, no external action.
 */
export class HrAgent extends BaseAgent {
  constructor() {
    super("HR", MODELS.HAIKU);
  }

  protected override async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as HrTaskType;

    if (taskType === "create_job_description") return this.createJobDescription(input);
    if (taskType === "screen_candidate") return this.screenCandidate(input);
    if (taskType === "draft_offer_letter") return this.draftOfferLetter(input);

    throw new Error(`HR agent does not handle task type: ${taskType}`);
  }

  private async createJobDescription(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { role, department, seniority, context } = input.parameters as {
      role: string;
      department: string;
      seniority: string;
      context?: string;
    };

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(HR_ROLE),
      userMessage: `Write a job description for this role.

Role: ${role}
Department: ${department}
Seniority: ${seniority}
${context ? `Context: ${context}` : ""}

Be specific — no generic requirements. Tailor to what this specific role actually needs.
Avoid: "ninja", "rockstar", "passionate", "self-starter". Be direct.

Return ONLY this JSON:
{
  "title": "...",
  "department": "...",
  "seniority": "...",
  "summary": "...",
  "responsibilities": ["...", "..."],
  "mustHaveRequirements": ["...", "..."],
  "niceToHaveRequirements": ["...", "..."],
  "compensationRange": "$120k - $160k",
  "workStyle": "remote|hybrid|onsite"
}`,
      maxTokens: 2500,
    });

    const parsed = this.parseJobDescription(result.content);

    const formattedJd = [
      `# ${parsed.title}`,
      `${parsed.seniority} | ${parsed.department} | ${parsed.workStyle}`,
      parsed.compensationRange ? `Compensation: ${parsed.compensationRange}` : "",
      "",
      parsed.summary,
      "",
      "## Responsibilities",
      ...parsed.responsibilities.map((r) => `- ${r}`),
      "",
      "## Requirements",
      ...parsed.mustHaveRequirements.map((r) => `- ${r}`),
      "",
      "## Nice to Have",
      ...parsed.niceToHaveRequirements.map((r) => `- ${r}`),
    ]
      .filter(Boolean)
      .join("\n");

    const approvalId = await this.createApproval({
      actionType: "publish_job_posting",
      outputContent: formattedJd,
      ringLevel: 2,
      confidence: 0.85,
    });

    return {
      content: formattedJd.slice(0, 500),
      summary: { approvalId, jobTitle: parsed.title, department: parsed.department },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "publish_job_posting",
      confidence: 0.85,
    };
  }

  private async screenCandidate(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { candidateId, jobPostingId } = input.parameters as {
      candidateId: string;
      jobPostingId: string;
    };

    const [candidate, jobPosting] = await Promise.all([
      db.query.candidates.findFirst({ where: eq(candidates.id, candidateId) }),
      db.query.jobPostings.findFirst({ where: eq(jobPostings.id, jobPostingId) }),
    ]);

    if (!candidate) throw new Error(`Candidate ${candidateId} not found`);
    if (!jobPosting) throw new Error(`Job posting ${jobPostingId} not found`);

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(HR_ROLE),
      userMessage: `Screen this candidate against the job requirements.

<external_data source="job_description">
Job: ${jobPosting.title}
Requirements: ${JSON.stringify(jobPosting.requirements)}
</external_data>

<external_data source="candidate_profile">
Name: ${candidate.firstName} ${candidate.lastName}
Resume summary: ${candidate.resumeSummary ?? "Not provided"}
Experience: ${candidate.experienceYears ?? "?"} years
Skills: ${JSON.stringify(candidate.skills ?? [])}
</external_data>

Score the candidate 0-100. List which must-have requirements are met vs missing.
Provide 3 targeted interview questions based on their specific gaps.

Return ONLY this JSON:
{
  "fitScore": 72,
  "mustHavesMet": ["..."],
  "mustHavesMissing": ["..."],
  "strengths": ["..."],
  "concerns": ["..."],
  "recommendation": "advance|hold|reject",
  "reasoningSummary": "...",
  "suggestedInterviewQuestions": ["...", "...", "..."]
}`,
      maxTokens: 2000,
    });

    const parsed = this.parseScreening(result.content);

    const screeningRecord = [
      `Candidate: ${candidate.firstName} ${candidate.lastName}`,
      `Fit Score: ${parsed.fitScore}/100`,
      `Recommendation: ${parsed.recommendation.toUpperCase()}`,
      "",
      parsed.reasoningSummary,
      "",
      `Must-haves met: ${parsed.mustHavesMet.join(", ")}`,
      `Must-haves missing: ${parsed.mustHavesMissing.join(", ")}`,
      "",
      "Interview questions:",
      ...parsed.suggestedInterviewQuestions.map((q) => `- ${q}`),
    ].join("\n");

    return {
      content: screeningRecord,
      summary: { candidateId, fitScore: parsed.fitScore, recommendation: parsed.recommendation },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "screen_candidate",
      confidence: 0.8,
    };
  }

  private async draftOfferLetter(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { candidateId, salary, startDate, role, additionalTerms } = input.parameters as {
      candidateId: string;
      salary: string;
      startDate: string;
      role: string;
      additionalTerms?: string;
    };

    const candidate = await db.query.candidates.findFirst({
      where: eq(candidates.id, candidateId),
    });

    if (!candidate) throw new Error(`Candidate ${candidateId} not found`);

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(HR_ROLE),
      userMessage: `Draft a professional offer letter.

Candidate: ${candidate.firstName} ${candidate.lastName}
Role: ${role}
Salary: ${salary}
Start date: ${startDate}
${additionalTerms ? `Additional terms: ${additionalTerms}` : ""}

Write a professional, warm offer letter. Include: role, compensation, start date, at-will employment notice.
Do not include clauses you are not certain are legally valid. Keep it concise.`,
      maxTokens: 1500,
    });

    // Offer letters are Ring 3 — legal commitment, founder must explicitly approve
    const approvalId = await this.createApproval({
      actionType: "send_offer_letter",
      outputContent: result.content,
      ringLevel: 3,
      confidence: 0.88,
    });

    return {
      content: `Offer letter drafted for ${candidate.firstName} ${candidate.lastName} — ${role} at ${salary}`,
      summary: { approvalId, candidateId, role, salary },
      approvalRequired: true,
      ringLevel: 3,
      actionType: "send_offer_letter",
      confidence: 0.88,
    };
  }

  private parseJobDescription(content: string): z.infer<typeof JobDescriptionSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return JobDescriptionSchema.parse(JSON.parse(match[0]));
    } catch {
      return {
        title: "Open Role",
        department: "Engineering",
        seniority: "Mid",
        summary: content.slice(0, 300),
        responsibilities: [],
        mustHaveRequirements: [],
        niceToHaveRequirements: [],
        workStyle: "remote",
      };
    }
  }

  private parseScreening(content: string): z.infer<typeof CandidateScreeningSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return CandidateScreeningSchema.parse(JSON.parse(match[0]));
    } catch {
      return {
        fitScore: 50,
        mustHavesMet: [],
        mustHavesMissing: [],
        strengths: [],
        concerns: [],
        recommendation: "hold",
        reasoningSummary: content.slice(0, 300),
        suggestedInterviewQuestions: [],
      };
    }
  }
}

const HR_ROLE = `You write job descriptions that attract the right people and screen candidates fairly.
No corporate jargon. No buzzwords. Specific, honest, direct.
You evaluate candidates on demonstrated skills and relevant experience — never on irrelevant factors.`;
