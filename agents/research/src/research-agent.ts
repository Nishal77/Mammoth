import { z } from "zod";
import { db, companyMemory, integrations } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";
import { BaseAgent } from "@mammoth/agent-base";
import { MODELS } from "@mammoth/agent-base";
import type { AgentTaskInput, AgentTaskOutput } from "@mammoth/agent-base";

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
 * Uses Exa AI for real-time web search when the integration is configured.
 * Falls back to model knowledge when Exa is not connected.
 * Findings are Ring 1 (internal write). Strategic pivots are Ring 3.
 */
export class ResearchAgent extends BaseAgent {
  constructor() {
    super("Research", MODELS.SONNET);
  }

  protected override async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as ResearchTaskType;

    if (taskType === "competitor_intel") return this.analyzeCompetitors(input);
    if (taskType === "market_analysis") return this.analyzeMarket(input);
    if (taskType === "trend_report") return this.buildTrendReport(input);

    throw new Error(`Research agent does not handle task type: ${taskType}`);
  }

  /**
   * Loads fresh web search results from Exa for the given query.
   * Returns an empty string if Exa is not connected — agents degrade gracefully.
   */
  private async loadLiveWebContext(query: string, numResults = 8): Promise<string> {
    const integration = await db.query.integrations.findFirst({
      where: and(
        eq(integrations.companyId, this.runCtx.companyId),
        eq(integrations.provider, "exa"),
        eq(integrations.status, "connected")
      ),
      columns: { accessTokenEnc: true },
    });

    if (!integration?.accessTokenEnc) return "";

    const { searchWeb, formatSearchResultsForPrompt } = await import("@mammoth/tool-exa");
    const { decryptToken } = await import("@mammoth/tool-oauth");

    let apiKey: string;
    try {
      apiKey = decryptToken(integration.accessTokenEnc);
    } catch {
      return "";
    }

    const results = await searchWeb(apiKey, {
      query,
      numResults,
      includeText: true,
      // Only results from the last 6 months for freshness
      startPublishedDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    });

    return formatSearchResultsForPrompt(results, 3000);
  }

  private async analyzeCompetitors(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { competitors, companyContext } = input.parameters as {
      competitors: string[];
      companyContext?: string;
    };

    // Pull live news and product pages for each competitor from the web
    const webContext = await this.loadLiveWebContext(
      `${competitors.join(" OR ")} product features pricing 2024 2025`,
      10
    );

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(RESEARCH_ROLE),
      userMessage: `Analyze these competitors and identify market gaps.

Competitors: ${competitors.join(", ")}
${companyContext ? `Our positioning: ${companyContext}` : ""}

${
  webContext
    ? `<external_data source="live_web_search">
${webContext}
</external_data>

Use the live search results above to ground your analysis in current data. Prioritise recent product moves and pricing signals from the search results.`
    : "Base your analysis on your knowledge of these companies."
}

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

    // Persist to competitor memory — Ring 1 (internal write, no external action)
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

    const highThreatCount = parsed.competitors.filter((c) => c.threatLevel === "high").length;
    const summary = `Analyzed ${parsed.competitors.length} competitors. Found ${parsed.marketGaps.length} market gaps. ${highThreatCount} high-threat competitors.`;

    return {
      content: summary,
      summary: {
        competitorsAnalyzed: parsed.competitors.length,
        marketGaps: parsed.marketGaps,
        usedLiveSearch: webContext.length > 0,
      },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "competitor_intel",
      confidence: webContext.length > 0 ? 0.9 : 0.78,
    };
  }

  private async analyzeMarket(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { topic, context } = input.parameters as { topic: string; context?: string };

    const webContext = await this.loadLiveWebContext(
      `${topic} market trend 2024 2025 industry report`,
      8
    );

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(RESEARCH_ROLE),
      userMessage: `Analyze this market trend and its strategic implications.

Topic: "${topic}"
${context ? `Context: ${context}` : ""}

${
  webContext
    ? `<external_data source="live_web_search">
${webContext}
</external_data>`
    : ""
}

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

    const memoryKey = `market_trend_${topic.toLowerCase().replace(/\s+/g, "_").slice(0, 50)}`;
    await db
      .insert(companyMemory)
      .values({
        companyId: this.runCtx.companyId,
        memoryType: "market_intel",
        key: memoryKey,
        value: JSON.stringify(parsed),
        source: "research_agent",
      })
      .onConflictDoUpdate({
        target: [companyMemory.companyId, companyMemory.memoryType, companyMemory.key],
        set: { value: JSON.stringify(parsed), updatedAt: new Date() },
      });

    return {
      content: `${parsed.trend} — ${parsed.impactLevel} impact over ${parsed.timeHorizon}.`,
      summary: {
        trend: parsed.trend,
        impactLevel: parsed.impactLevel,
        actionsCount: parsed.recommendedActions.length,
        usedLiveSearch: webContext.length > 0,
      },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "market_analysis",
      confidence: webContext.length > 0 ? 0.88 : 0.75,
    };
  }

  private async buildTrendReport(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { industry, focusAreas } = input.parameters as {
      industry: string;
      focusAreas?: string[];
    };

    const webContext = await this.loadLiveWebContext(
      `${industry} ${focusAreas?.join(" ") ?? ""} trends predictions 2025`,
      12
    );

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(RESEARCH_ROLE),
      userMessage: `Write a strategic trend report for the ${industry} industry.
${focusAreas ? `Focus areas: ${focusAreas.join(", ")}` : ""}

${
  webContext
    ? `<external_data source="live_web_search">
${webContext}
</external_data>

Ground your report in the live search results above. Cite specific developments you found.`
    : ""
}

Include 5-7 key trends, their impact levels, timeframes, and strategic implications.
Write in prose, structured with clear sections. This will be shared with the founding team.`,
      maxTokens: 4000,
    });

    const approvalId = await this.createApproval({
      actionType: "share_trend_report",
      outputContent: result.content,
      ringLevel: 2,
      confidence: webContext.length > 0 ? 0.9 : 0.8,
    });

    return {
      content: result.content.slice(0, 300) + "...",
      summary: { approvalId, industry, usedLiveSearch: webContext.length > 0 },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "share_trend_report",
      confidence: webContext.length > 0 ? 0.9 : 0.8,
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
}

const RESEARCH_ROLE = `You synthesize market intelligence into actionable strategic insight.
You separate signal from noise. You never speculate beyond what evidence supports.
You cite your reasoning clearly so founders can evaluate your conclusions.
When given live web search results, prioritize recent data over your training knowledge.`;
