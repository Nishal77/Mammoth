import { z } from "zod";
import { db, companyMemory, approvals, companies } from "@mammoth/db";
import { eq, and } from "drizzle-orm";
import { BaseAgent } from "../base/base-agent.ts";
import { MODELS } from "../router/model-router.ts";
import type { AgentTaskInput, AgentTaskOutput } from "../base/base-agent.ts";
import { publishNotification } from "@mammoth/db";

const CompetitorAnalysisSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      positioning: z.string(),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
      recentMoves: z.array(z.string()),
      pricingSignals: z.string().optional(),
      threatLevel: z.enum(["low", "medium", "high"]),
    })
  ),
  marketGaps: z.array(z.string()),
  recommendedPositioningShifts: z.array(z.string()),
});

const MarketAnalysisSchema = z.object({
  trend: z.string(),
  impactLevel: z.enum(["low", "medium", "high"]),
  timeHorizon: z.string(),
  implications: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  sources: z.array(z.string()),
});

type ResearchTaskType = "competitor_intel" | "market_analysis" | "trend_report";

/**
 * Research Agent — competitor intel, market analysis, trend reports.
 * Findings are Ring 1 (internal read/write to memory). Recommended pivots are Ring 3.
 */
export class ResearchAgent extends BaseAgent {
  constructor() {
    super("Research", MODELS.SONNET);
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as ResearchTaskType;

    if (taskType === "competitor_intel") return this.analyzeCompetitors(input);
    if (taskType === "market_analysis") return this.analyzeMarket(input);
    if (taskType === "trend_report") return this.buildTrendReport(input);

    throw new Error(`Research agent does not handle task type: ${taskType}`);
  }

  private async analyzeCompetitors(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { competitors, companyContext } = input.parameters as {
      competitors: string[];
      companyContext?: string;
    };

    const systemPrompt = this.buildSystemPrompt(RESEARCH_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Analyze these competitors and identify market gaps.

Competitors: ${competitors.join(", ")}
${companyContext ? `Our positioning: ${companyContext}` : ""}

For each competitor, analyze their current positioning, publicly known strengths/weaknesses, recent product or marketing moves, and threat level.
Identify market gaps they are not addressing.
Suggest positioning shifts we could make.

Return ONLY this JSON:
{
  "competitors": [
    {
      "name": "...",
      "positioning": "...",
      "strengths": ["...", "..."],
      "weaknesses": ["...", "..."],
      "recentMoves": ["..."],
      "pricingSignals": "...",
      "threatLevel": "high|medium|low"
    }
  ],
  "marketGaps": ["...", "..."],
  "recommendedPositioningShifts": ["...", "..."]
}`,
      maxTokens: 4000,
    });

    const parsed = this.parseCompetitorAnalysis(result.content);

    // Upsert into competitor memory — Ring 1 (research write, no approval)
    await db
      .insert(companyMemory)
      .values({
        companyId: this.runCtx.companyId,
        memoryType: "competitor",
        key: "competitor_analysis",
        value: JSON.stringify(parsed),
        source: "research_agent",
      })
      .onConflictDoUpdate({
        target: [companyMemory.companyId, companyMemory.memoryType, companyMemory.key],
        set: { value: JSON.stringify(parsed), updatedAt: new Date() },
      });

    const summary = `Analyzed ${parsed.competitors.length} competitors. Found ${parsed.marketGaps.length} market gaps. ${parsed.competitors.filter((c) => c.threatLevel === "high").length} high-threat competitors.`;

    return {
      content: summary,
      summary: { competitorsAnalyzed: parsed.competitors.length, marketGaps: parsed.marketGaps },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "competitor_intel",
      confidence: 0.78,
    };
  }

  private async analyzeMarket(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { topic, context } = input.parameters as { topic: string; context?: string };

    const systemPrompt = this.buildSystemPrompt(RESEARCH_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Analyze this market trend and its strategic implications.

Topic: "${topic}"
${context ? `Context: ${context}` : ""}

Assess the trend's impact level, timeframe, and specific implications for our business. List concrete actions we could take.

Return ONLY this JSON:
{
  "trend": "...",
  "impactLevel": "low|medium|high",
  "timeHorizon": "3-6 months",
  "implications": ["...", "..."],
  "recommendedActions": ["...", "..."],
  "sources": ["..."]
}`,
      maxTokens: 2500,
    });

    const parsed = this.parseMarketAnalysis(result.content);

    await db
      .insert(companyMemory)
      .values({
        companyId: this.runCtx.companyId,
        memoryType: "competitor",
        key: `market_trend_${topic.toLowerCase().replace(/\s+/g, "_").slice(0, 50)}`,
        value: JSON.stringify(parsed),
        source: "research_agent",
      })
      .onConflictDoUpdate({
        target: [companyMemory.companyId, companyMemory.memoryType, companyMemory.key],
        set: { value: JSON.stringify(parsed), updatedAt: new Date() },
      });

    return {
      content: `${parsed.trend} — ${parsed.impactLevel} impact over ${parsed.timeHorizon}.`,
      summary: { trend: parsed.trend, impactLevel: parsed.impactLevel, actionsCount: parsed.recommendedActions.length },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "market_analysis",
      confidence: 0.75,
    };
  }

  private async buildTrendReport(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { industry, focusAreas } = input.parameters as {
      industry: string;
      focusAreas?: string[];
    };

    const systemPrompt = this.buildSystemPrompt(RESEARCH_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Write a strategic trend report for the ${industry} industry.
${focusAreas ? `Focus areas: ${focusAreas.join(", ")}` : ""}

Include 5-7 key trends, their impact levels, timeframes, and strategic implications.
Write in prose, structured with clear sections. This will be shared with the founding team.`,
      maxTokens: 3500,
    });

    const approvalId = await this.createApproval({
      actionType: "share_trend_report",
      outputContent: result.content,
      ringLevel: 2,
      confidence: 0.8,
    });

    return {
      content: result.content.slice(0, 300) + "...",
      summary: { approvalId, industry },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "share_trend_report",
      confidence: 0.8,
    };
  }

  private parseCompetitorAnalysis(content: string): z.infer<typeof CompetitorAnalysisSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return CompetitorAnalysisSchema.parse(JSON.parse(match[0]));
    } catch {
      return { competitors: [], marketGaps: [], recommendedPositioningShifts: [] };
    }
  }

  private parseMarketAnalysis(content: string): z.infer<typeof MarketAnalysisSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return MarketAnalysisSchema.parse(JSON.parse(match[0]));
    } catch {
      return {
        trend: content.slice(0, 200),
        impactLevel: "medium",
        timeHorizon: "6-12 months",
        implications: [],
        recommendedActions: [],
        sources: [],
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
        department: "research",
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

const RESEARCH_ROLE = `You synthesize market intelligence into actionable strategic insight.
You separate signal from noise. You never speculate beyond what evidence supports.
You cite your reasoning clearly so founders can evaluate your conclusions.`;
