import { z } from "zod";
import { db, leads } from "@mammoth/db";
import { eq } from "drizzle-orm";
import { BaseAgent } from "../base/base-agent.ts";
import { MODELS } from "../router/model-router.ts";
import type { AgentTaskInput, AgentTaskOutput } from "../base/base-agent.ts";

const LeadResearchOutputSchema = z.object({
  leads: z.array(
    z.object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string().optional(),
      title: z.string(),
      company: z.string(),
      companySize: z.string().optional(),
      linkedinUrl: z.string().optional(),
      icpScore: z.number().int().min(0).max(100),
      painPoints: z.array(z.string()),
    })
  ),
});

const OutreachOutputSchema = z.object({
  subject: z.string(),
  email1: z.string(),
  email2: z.string(),
  email3: z.string(),
  linkedinMessage: z.string().max(300),
});

type SalesTaskType = "lead_research" | "outreach_sequence" | "crm_update";

/**
 * Sales Agent — lead research, outreach sequences, CRM operations.
 * Lead research is Ring 1 (no approval needed, read-only action).
 * Outreach sequences are Ring 2 (4h veto before emails are sent).
 */
export class SalesAgent extends BaseAgent {
  constructor() {
    super("Sales", MODELS.HAIKU);
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as SalesTaskType;

    if (taskType === "lead_research") return this.researchLeads(input);
    if (taskType === "outreach_sequence") return this.buildOutreachSequence(input);

    throw new Error(`Sales agent does not handle task type: ${taskType}`);
  }

  private async researchLeads(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { icp, count = 5 } = input.parameters as {
      icp: string;
      count?: number;
    };

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(SALES_ROLE),
      userMessage: `Research ${count} qualified leads matching this ICP: "${icp}".

For each lead provide realistic data: name, title, company, company size, estimated email pattern, LinkedIn URL, ICP fit score 0-100, and 2-3 specific pain points.

Return ONLY this JSON:
{
  "leads": [
    {
      "firstName": "...",
      "lastName": "...",
      "email": "...",
      "title": "...",
      "company": "...",
      "companySize": "51-200",
      "linkedinUrl": "https://linkedin.com/in/...",
      "icpScore": 85,
      "painPoints": ["...", "..."]
    }
  ]
}`,
      maxTokens: 3000,
    });

    const parsed = this.parseLeads(result.content);

    // Persist leads to DB — Ring 1, no approval gate for read-only research
    for (const lead of parsed.leads) {
      await db
        .insert(leads)
        .values({
          companyId: this.runCtx.companyId,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email ?? null,
          title: lead.title,
          companyName: lead.company,
          companySize: lead.companySize ?? null,
          linkedinUrl: lead.linkedinUrl ?? null,
          icpScore: lead.icpScore.toString(),
          enrichmentData: { painPoints: lead.painPoints },
          source: "ai_research",
          status: "new",
        })
        .onConflictDoNothing();
    }

    return {
      content: parsed.leads
        .map((l) => `${l.firstName} ${l.lastName} @ ${l.company} (ICP: ${l.icpScore}%)`)
        .join("\n"),
      summary: { leadsFound: parsed.leads.length, leads: parsed.leads },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "lead_research",
      confidence: 0.8,
    };
  }

  private async buildOutreachSequence(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { leadId, context } = input.parameters as {
      leadId: string;
      context?: string;
    };

    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, leadId),
    });

    if (!lead) throw new Error(`Lead ${leadId} not found`);

    const painPoints =
      (lead.enrichmentData as { painPoints?: string[] } | null)?.painPoints ?? [];

    const leadContext = `Lead: ${lead.firstName} ${lead.lastName}, ${lead.title} at ${lead.companyName ?? "—"}
Pain points: ${painPoints.join(", ") || "unknown"}
${context ?? ""}`;

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(SALES_ROLE),
      userMessage: `Write a 3-email cold outreach sequence + LinkedIn message for this lead.

${leadContext}

Rules:
- Email 1: short, specific, no generic opener, value-first
- Email 2: follow-up 3 days later, add social proof or case study
- Email 3: break-up email 5 days later, final ask
- LinkedIn: connection request message, max 300 chars
- All content specific to their pain points, not generic

Return ONLY this JSON:
{
  "subject": "...",
  "email1": "...",
  "email2": "...",
  "email3": "...",
  "linkedinMessage": "..."
}`,
      maxTokens: 2000,
    });

    const parsed = this.parseOutreach(result.content);

    const outputContent = [
      `To: ${lead.firstName} ${lead.lastName} <${lead.email ?? "—"}>`,
      `Subject: ${parsed.subject}`,
      "",
      "---EMAIL 1---",
      parsed.email1,
      "",
      "---EMAIL 2---",
      parsed.email2,
      "",
      "---EMAIL 3---",
      parsed.email3,
      "",
      "---LINKEDIN---",
      parsed.linkedinMessage,
    ].join("\n");

    const approvalId = await this.createApproval({
      actionType: "send_outreach_sequence",
      outputContent,
      ringLevel: 2,
      confidence: 0.82,
    });

    return {
      content: parsed.email1,
      summary: { approvalId, subject: parsed.subject, leadId },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "send_outreach_sequence",
      confidence: 0.82,
    };
  }

  private parseLeads(content: string): z.infer<typeof LeadResearchOutputSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return LeadResearchOutputSchema.parse(JSON.parse(match[0]));
    } catch {
      return { leads: [] };
    }
  }

  private parseOutreach(content: string): z.infer<typeof OutreachOutputSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return OutreachOutputSchema.parse(JSON.parse(match[0]));
    } catch {
      return {
        subject: "Following up",
        email1: content.slice(0, 500),
        email2: "",
        email3: "",
        linkedinMessage: content.slice(0, 300),
      };
    }
  }
}

const SALES_ROLE = `You identify high-fit prospects and write direct, personalized outreach.
Every message is specific to the person — never generic. Reference their actual role, company stage, and pain points.
You do not use manipulative tactics. You offer real value.`;
