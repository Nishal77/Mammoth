import { z } from "zod";
import { db, leads, integrations } from "@mammoth/db";
import { eq, and } from "drizzle-orm";
import type { ApolloLead } from "@mammoth/integrations/apollo";
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
 * Uses Apollo.io for real prospect data when the integration is configured.
 * Falls back to AI-synthesised leads if Apollo is not connected.
 * Outreach sequences are Ring 2 (4h veto before emails are dispatched).
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
    const { icp, count = 10, titles, locations } = input.parameters as {
      icp: string;
      count?: number;
      titles?: string[];
      locations?: string[];
    };

    // Try Apollo first — real verified lead data
    const apolloLeads = await this.fetchFromApollo(icp, count, titles, locations);

    if (apolloLeads.length > 0) {
      return this.persistAndReturnLeads(apolloLeads, "apollo");
    }

    // Fallback: AI-synthesised leads when Apollo is not connected
    return this.synthesiseLeadsWithAi(icp, count);
  }

  private async fetchFromApollo(
    icp: string,
    count: number,
    titles?: string[],
    locations?: string[]
  ): Promise<z.infer<typeof LeadResearchOutputSchema>["leads"]> {
    const integration = await db.query.integrations.findFirst({
      where: and(
        eq(integrations.companyId, this.runCtx.companyId),
        eq(integrations.provider, "apollo"),
        eq(integrations.status, "connected")
      ),
      columns: { accessTokenEnc: true },
    });

    if (!integration?.accessTokenEnc) return [];

    // Import at call time — keeps the package boundary clear
    const { searchApolloLeads } = await import("@mammoth/integrations/apollo");
    const { decryptToken } = await import("@mammoth/integrations/oauth");

    let apiKey: string;
    try {
      apiKey = decryptToken(integration.accessTokenEnc);
    } catch {
      return [];
    }

    const apolloLeads = await searchApolloLeads(apiKey, {
      personTitles: titles ?? [],
      personLocations: locations ?? [],
      keywords: [icp],
      perPage: Math.min(count, 25),
    });

    return apolloLeads.map((l: ApolloLead) => ({
      firstName: l.firstName,
      lastName: l.lastName,
      email: l.email ?? undefined,
      title: l.title,
      company: l.company,
      companySize: undefined,
      linkedinUrl: l.linkedinUrl ?? undefined,
      icpScore: 75,
      painPoints: [],
    }));
  }

  private async synthesiseLeadsWithAi(
    icp: string,
    count: number
  ): Promise<AgentTaskOutput> {
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
    return this.persistAndReturnLeads(parsed.leads, "ai_research");
  }

  private async persistAndReturnLeads(
    leadList: z.infer<typeof LeadResearchOutputSchema>["leads"],
    source: string
  ): Promise<AgentTaskOutput> {
    for (const lead of leadList) {
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
          source,
          status: "new",
        })
        .onConflictDoNothing();
    }

    return {
      content: leadList
        .map((l) => `${l.firstName} ${l.lastName} @ ${l.company} (ICP: ${l.icpScore}%)`)
        .join("\n"),
      summary: { leadsFound: leadList.length, source, leads: leadList },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "lead_research",
      confidence: source === "apollo" ? 0.95 : 0.75,
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
