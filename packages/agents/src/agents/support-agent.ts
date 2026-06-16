import { z } from "zod";
import { db, supportTickets, approvals, companies } from "@mammoth/db";
import { eq } from "drizzle-orm";
import { BaseAgent } from "../base/base-agent.ts";
import { MODELS } from "../router/model-router.ts";
import type { AgentTaskInput, AgentTaskOutput } from "../base/base-agent.ts";
import { publishNotification } from "@mammoth/db";

const TicketResolutionSchema = z.object({
  suggestedReply: z.string(),
  resolutionCategory: z.enum(["billing", "technical", "product", "general", "escalate"]),
  confidence: z.number().min(0).max(1),
  shouldCreateKbArticle: z.boolean(),
  kbArticleTitle: z.string().optional(),
  kbArticleContent: z.string().optional(),
});

const KbArticleSchema = z.object({
  title: z.string(),
  content: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
});

type SupportTaskType = "resolve_ticket" | "create_kb_article" | "update_kb_article";

/**
 * Support Agent — ticket resolution, knowledge base maintenance.
 * Ticket replies are Ring 2 (human review). KB article creation is Ring 2.
 */
export class SupportAgent extends BaseAgent {
  constructor() {
    super("Support", MODELS.HAIKU);
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as SupportTaskType;

    if (taskType === "resolve_ticket") return this.resolveTicket(input);
    if (taskType === "create_kb_article") return this.createKbArticle(input);

    throw new Error(`Support agent does not handle task type: ${taskType}`);
  }

  private async resolveTicket(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { ticketId } = input.parameters as { ticketId: string };

    const ticket = await db.query.supportTickets.findFirst({
      where: eq(supportTickets.id, ticketId),
    });

    if (!ticket) throw new Error(`Ticket ${ticketId} not found`);

    const systemPrompt = this.buildSystemPrompt(SUPPORT_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Resolve this support ticket.

<external_data source="support_ticket">
Subject: ${ticket.subject}
Body: ${ticket.body}
Priority: ${ticket.priority}
Customer email: ${ticket.customerEmail}
</external_data>

Write a helpful, empathetic reply that resolves the issue. If this is a billing issue, acknowledge and offer next step. If technical, give a clear solution. If you cannot resolve it, recommend escalation.

Return ONLY this JSON:
{
  "suggestedReply": "...",
  "resolutionCategory": "technical|billing|product|general|escalate",
  "confidence": 0.85,
  "shouldCreateKbArticle": true,
  "kbArticleTitle": "...",
  "kbArticleContent": "..."
}`,
      maxTokens: 2000,
    });

    const parsed = this.parseResolution(result.content);

    const approvalId = await this.createApproval({
      actionType: "send_support_reply",
      outputContent: `To: ${ticket.customerEmail}\nSubject: Re: ${ticket.subject}\n\n${parsed.suggestedReply}`,
      ringLevel: 2,
      confidence: parsed.confidence,
    });

    if (parsed.shouldCreateKbArticle && parsed.kbArticleTitle && parsed.kbArticleContent) {
      await this.scheduleKbArticle(parsed.kbArticleTitle, parsed.kbArticleContent, parsed.resolutionCategory);
    }

    return {
      content: parsed.suggestedReply,
      summary: { approvalId, ticketId, resolutionCategory: parsed.resolutionCategory },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "send_support_reply",
      confidence: parsed.confidence,
    };
  }

  private async createKbArticle(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { topic, context } = input.parameters as { topic: string; context?: string };

    const systemPrompt = this.buildSystemPrompt(SUPPORT_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Write a knowledge base article on this topic.

Topic: "${topic}"
${context ? `Context: ${context}` : ""}

The article should be clear, structured with headings, include steps where applicable, and be written for non-technical readers.

Return ONLY this JSON:
{
  "title": "...",
  "content": "...",
  "category": "...",
  "tags": ["...", "..."]
}`,
      maxTokens: 2500,
    });

    const parsed = this.parseKbArticle(result.content);

    const approvalId = await this.createApproval({
      actionType: "publish_kb_article",
      outputContent: `# ${parsed.title}\n\nCategory: ${parsed.category}\nTags: ${parsed.tags.join(", ")}\n\n${parsed.content}`,
      ringLevel: 2,
      confidence: 0.8,
    });

    return {
      content: parsed.title,
      summary: { approvalId, articleTitle: parsed.title, tags: parsed.tags },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "publish_kb_article",
      confidence: 0.8,
    };
  }

  private async scheduleKbArticle(title: string, content: string, category: string): Promise<void> {
    await this.createApproval({
      actionType: "publish_kb_article",
      outputContent: `# ${title}\n\nCategory: ${category}\n\n${content}`,
      ringLevel: 2,
      confidence: 0.75,
    });
  }

  private parseResolution(content: string): z.infer<typeof TicketResolutionSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return TicketResolutionSchema.parse(JSON.parse(match[0]));
    } catch {
      return {
        suggestedReply: content.slice(0, 1000),
        resolutionCategory: "general",
        confidence: 0.5,
        shouldCreateKbArticle: false,
      };
    }
  }

  private parseKbArticle(content: string): z.infer<typeof KbArticleSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return KbArticleSchema.parse(JSON.parse(match[0]));
    } catch {
      return { title: "Untitled", content, category: "general", tags: [] };
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
        department: "support",
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

const SUPPORT_ROLE = `You resolve customer issues with empathy and precision.
You write in plain language — no jargon, no templates. Every reply is specific to the customer's actual problem.
When you don't know the answer, you say so clearly and escalate.`;
