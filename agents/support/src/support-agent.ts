import { z } from "zod";
import { db, supportTickets } from "@mammoth/memory-database";
import { eq } from "drizzle-orm";
import { BaseAgent } from "@mammoth/agent-base";
import { MODELS } from "@mammoth/agent-base";
import type { AgentTaskInput, AgentTaskOutput } from "@mammoth/agent-base";

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

type SupportTaskType = "resolve_ticket" | "create_kb_article" | "update_kb_article" | "initiate_voice_call";

/**
 * Support Agent — ticket resolution, knowledge base maintenance, voice callbacks.
 * Ticket replies and KB articles are Ring 2 (human review).
 * Voice calls are Ring 3 — explicit founder approval required before any call is placed.
 */
export class SupportAgent extends BaseAgent {
  constructor() {
    super("Support", MODELS.HAIKU);
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as SupportTaskType;

    if (taskType === "resolve_ticket") return this.resolveTicket(input);
    if (taskType === "create_kb_article") return this.createKbArticle(input);
    if (taskType === "initiate_voice_call") return this.prepareVoiceCall(input);

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

  /**
   * Prepares a Vapi voice call script for a customer callback.
   * Ring 3 — founder must explicitly approve before any call is placed.
   * The execution worker parses CALL_TO from outputContent to get the phone number.
   */
  private async prepareVoiceCall(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { ticketId, customerName, phoneNumber, issueContext } = input.parameters as {
      ticketId?: string;
      customerName: string;
      phoneNumber: string;
      issueContext: string;
    };

    let ticketContext = issueContext;

    if (ticketId) {
      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, ticketId),
        columns: { subject: true, body: true, priority: true },
      });
      if (ticket) {
        ticketContext = `Issue: ${ticket.subject}\nDetails: ${ticket.body}\nPriority: ${ticket.priority}`;
      }
    }

    const systemPrompt = this.buildSystemPrompt(SUPPORT_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Write a natural phone call script for an AI agent calling a customer about their support issue.

Customer: ${customerName}

<external_data source="support_ticket">
${ticketContext}
</external_data>

Write a short, natural conversation script (not robotic). The AI agent should:
1. Introduce itself as an automated assistant calling on behalf of the support team
2. Confirm the customer's issue
3. Offer a resolution or timeline
4. Ask if they have questions

Keep it under 2 minutes. Write the script in plain prose, not bullet points.`,
      maxTokens: 1000,
    });

    // CALL_TO line is parsed by the execution worker's dispatchVoiceCall function
    const callSpec = [
      `CALL_TO: ${phoneNumber}`,
      `CUSTOMER: ${customerName}`,
      "",
      result.content,
    ].join("\n");

    const approvalId = await this.createApproval({
      actionType: "initiate_voice_call",
      outputContent: callSpec,
      // Ring 3 — never auto-executes. Founder must explicitly approve.
      ringLevel: 3,
      confidence: 0.75,
    });

    return {
      content: `Voice call prepared for ${customerName} (${phoneNumber})`,
      summary: { approvalId, customerName, phoneNumber, ticketId },
      approvalRequired: true,
      ringLevel: 3,
      actionType: "initiate_voice_call",
      confidence: 0.75,
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

}

const SUPPORT_ROLE = `You resolve customer issues with empathy and precision.
You write in plain language — no jargon, no templates. Every reply is specific to the customer's actual problem.
When you don't know the answer, you say so clearly and escalate.`;
