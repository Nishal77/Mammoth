import { z } from "zod";
import { db, agentTasks, approvals, companies } from "@mammoth/db";
import { eq } from "drizzle-orm";
import { BaseAgent } from "../base/base-agent.ts";
import { MODELS } from "../router/model-router.ts";
import type { AgentTaskInput, AgentTaskOutput } from "../base/base-agent.ts";
import { publishNotification } from "@mammoth/db";

const SprintPlanSchema = z.object({
  sprintGoal: z.string(),
  tickets: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      type: z.enum(["feature", "bug", "chore", "spike"]),
      estimatePoints: z.number().int().min(1).max(13),
      priority: z.enum(["critical", "high", "medium", "low"]),
    })
  ),
  totalPoints: z.number(),
  suggestedCapacity: z.number(),
});

const PrReviewSchema = z.object({
  summary: z.string(),
  approvalRecommendation: z.enum(["approve", "request_changes", "needs_discussion"]),
  issues: z.array(z.object({
    severity: z.enum(["blocker", "major", "minor", "nit"]),
    file: z.string().optional(),
    description: z.string(),
    suggestion: z.string().optional(),
  })),
  securityFlags: z.array(z.string()),
  testCoverageAssessment: z.string(),
});

type EngineeringTaskType = "sprint_planning" | "pr_review" | "issue_triage";

/**
 * Engineering Agent — sprint planning, PR review, issue triage.
 * CANNOT push to main — blocked at tool level (no push tool exists here).
 * All code-affecting suggestions are Ring 3 (explicit founder approval).
 */
export class EngineeringAgent extends BaseAgent {
  constructor() {
    super("Engineering", MODELS.SONNET);
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as EngineeringTaskType;

    if (taskType === "sprint_planning") return this.planSprint(input);
    if (taskType === "pr_review") return this.reviewPr(input);
    if (taskType === "issue_triage") return this.triageIssue(input);

    throw new Error(`Engineering agent does not handle task type: ${taskType}`);
  }

  private async planSprint(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { goals, backlogSummary, teamCapacity = 40 } = input.parameters as {
      goals: string[];
      backlogSummary?: string;
      teamCapacity?: number;
    };

    const systemPrompt = this.buildSystemPrompt(ENGINEERING_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Plan a 2-week engineering sprint.

Sprint goals: ${goals.join(", ")}
Team capacity: ${teamCapacity} story points
${backlogSummary ? `Backlog context: ${backlogSummary}` : ""}

Break goals into concrete tickets with estimates. Do not exceed capacity.

Return ONLY this JSON:
{
  "sprintGoal": "...",
  "tickets": [
    {
      "title": "...",
      "description": "...",
      "type": "feature|bug|chore|spike",
      "estimatePoints": 3,
      "priority": "high"
    }
  ],
  "totalPoints": 38,
  "suggestedCapacity": 40
}`,
      maxTokens: 3500,
    });

    const parsed = this.parseSprintPlan(result.content);

    const outputContent = [
      `Sprint Goal: ${parsed.sprintGoal}`,
      `Total: ${parsed.totalPoints} / ${parsed.suggestedCapacity} points`,
      "",
      ...parsed.tickets.map((t) => `[${t.type.toUpperCase()}] ${t.title} (${t.estimatePoints}pts) — ${t.priority}`),
    ].join("\n");

    const approvalId = await this.createApproval({
      actionType: "execute_sprint_plan",
      outputContent,
      ringLevel: 3,
      confidence: 0.82,
    });

    return {
      content: outputContent,
      summary: { approvalId, sprintGoal: parsed.sprintGoal, ticketCount: parsed.tickets.length },
      approvalRequired: true,
      ringLevel: 3,
      actionType: "execute_sprint_plan",
      confidence: 0.82,
    };
  }

  private async reviewPr(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { prTitle, prDescription, diff, authorNote } = input.parameters as {
      prTitle: string;
      prDescription: string;
      diff: string;
      authorNote?: string;
    };

    const systemPrompt = this.buildSystemPrompt(ENGINEERING_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Review this pull request.

PR: ${prTitle}
Description: ${prDescription}
${authorNote ? `Author note: ${authorNote}` : ""}

<external_data source="pull_request_diff">
${diff.slice(0, 8000)}
</external_data>

Review for: correctness, security vulnerabilities, test coverage, code clarity, architectural issues.
Flag any security concerns explicitly.

Return ONLY this JSON:
{
  "summary": "...",
  "approvalRecommendation": "approve|request_changes|needs_discussion",
  "issues": [
    {
      "severity": "blocker|major|minor|nit",
      "file": "src/...",
      "description": "...",
      "suggestion": "..."
    }
  ],
  "securityFlags": ["..."],
  "testCoverageAssessment": "..."
}`,
      maxTokens: 3000,
    });

    const parsed = this.parsePrReview(result.content);

    const outputContent = [
      `PR Review: ${prTitle}`,
      `Recommendation: ${parsed.approvalRecommendation.toUpperCase()}`,
      "",
      parsed.summary,
      "",
      parsed.securityFlags.length > 0 ? `SECURITY FLAGS:\n${parsed.securityFlags.map((f) => `- ${f}`).join("\n")}` : "",
      "",
      `Issues (${parsed.issues.length}):`,
      ...parsed.issues.map((i) => `[${i.severity.toUpperCase()}] ${i.file ? `${i.file}: ` : ""}${i.description}`),
      "",
      `Test coverage: ${parsed.testCoverageAssessment}`,
    ].filter(Boolean).join("\n");

    // PR reviews with security flags are Ring 3; otherwise Ring 2
    const ringLevel = parsed.securityFlags.length > 0 ? 3 : 2;

    const approvalId = await this.createApproval({
      actionType: "pr_review_comment",
      outputContent,
      ringLevel,
      confidence: 0.85,
    });

    return {
      content: parsed.summary,
      summary: { approvalId, recommendation: parsed.approvalRecommendation, issueCount: parsed.issues.length, securityFlagCount: parsed.securityFlags.length },
      approvalRequired: true,
      ringLevel,
      actionType: "pr_review_comment",
      confidence: 0.85,
    };
  }

  private async triageIssue(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { issueTitle, issueBody, labels } = input.parameters as {
      issueTitle: string;
      issueBody: string;
      labels?: string[];
    };

    const systemPrompt = this.buildSystemPrompt(ENGINEERING_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Triage this issue.

Title: ${issueTitle}
Labels: ${labels?.join(", ") ?? "none"}

<external_data source="issue_body">
${issueBody}
</external_data>

Assess severity, type, estimated complexity, and suggest next action.
Return concise triage notes in plain text.`,
      maxTokens: 800,
    });

    return {
      content: result.content,
      summary: { issueTitle, triaged: true },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "issue_triage",
      confidence: 0.78,
    };
  }

  private parseSprintPlan(content: string): z.infer<typeof SprintPlanSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return SprintPlanSchema.parse(JSON.parse(match[0]));
    } catch {
      return { sprintGoal: "Sprint", tickets: [], totalPoints: 0, suggestedCapacity: 40 };
    }
  }

  private parsePrReview(content: string): z.infer<typeof PrReviewSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return PrReviewSchema.parse(JSON.parse(match[0]));
    } catch {
      return {
        summary: content.slice(0, 500),
        approvalRecommendation: "needs_discussion",
        issues: [],
        securityFlags: [],
        testCoverageAssessment: "Not assessed",
      };
    }
  }

  private async createApproval(options: {
    actionType: string;
    outputContent: string;
    ringLevel: 1 | 2 | 3;
    confidence: number;
  }): Promise<string> {
    const expiresAt = options.ringLevel === 2 ? new Date(Date.now() + 4 * 60 * 60 * 1000) : null;

    const [approval] = await db
      .insert(approvals)
      .values({
        companyId: this.runCtx.companyId,
        taskId: this.runCtx.taskId,
        department: "engineering",
        actionType: options.actionType,
        ringLevel: options.ringLevel,
        outputContent: options.outputContent,
        confidence: options.confidence.toString(),
        status: "pending",
        expiresAt,
      })
      .returning({ id: approvals.id });

    const company = await db.query.companies.findFirst({
      where: eq(companies.id, this.runCtx.companyId),
      columns: { ownerId: true },
    });

    if (company) {
      await publishNotification({ type: "approval_created", userId: company.ownerId, approvalId: approval!.id });
    }

    return approval!.id;
  }
}

const ENGINEERING_ROLE = `You plan engineering work and review code with the rigor of a senior engineer.
You flag security issues without hesitation. You are precise about complexity estimates.
You cannot push code. You produce plans and reviews for human engineers to execute.`;
