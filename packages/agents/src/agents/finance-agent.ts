import { z } from "zod";
import { db, metrics, companyGoals } from "@mammoth/db";
import { eq, gte, desc } from "drizzle-orm";
import { BaseAgent } from "../base/base-agent.ts";
import { MODELS } from "../router/model-router.ts";
import type { AgentTaskInput, AgentTaskOutput } from "../base/base-agent.ts";

const FinancialReportSchema = z.object({
  period: z.string(),
  mrrGrowthRate: z.number().optional(),
  burnRate: z.number().optional(),
  runway: z.string().optional(),
  topRevenueDrivers: z.array(z.string()),
  costOptimizationOpportunities: z.array(z.string()),
  keyInsights: z.array(z.string()),
  alerts: z.array(z.object({ severity: z.enum(["info", "warning", "critical"]), message: z.string() })),
});

type FinanceTaskType = "financial_report" | "burn_analysis" | "revenue_analysis";

/**
 * Finance Agent — READ-ONLY by architecture. No write tools, no approvals created.
 * It reports; it never acts. This is not a configuration option.
 */
export class FinanceAgent extends BaseAgent {
  constructor() {
    super("Finance", MODELS.HAIKU);
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as FinanceTaskType;

    if (taskType === "financial_report") return this.generateFinancialReport(input);
    if (taskType === "burn_analysis") return this.analyzeBurn(input);
    if (taskType === "revenue_analysis") return this.analyzeRevenue(input);

    throw new Error(`Finance agent does not handle task type: ${taskType}`);
  }

  private async generateFinancialReport(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { period = "30d" } = input.parameters as { period?: string };

    const sinceDate = this.periodToDate(period);

    const recentMetrics = await db
      .select({
        mrr: metrics.mrr,
        totalRevenue: metrics.totalRevenue,
        totalLeads: metrics.totalLeads,
        totalCustomers: metrics.totalCustomers,
        recordedAt: metrics.recordedAt,
      })
      .from(metrics)
      .where(eq(metrics.companyId, this.runCtx.companyId))
      .orderBy(desc(metrics.recordedAt))
      .limit(30);

    const activeGoals = await db
      .select({
        title: companyGoals.title,
        targetValue: companyGoals.targetValue,
        currentValue: companyGoals.currentValue,
        unit: companyGoals.unit,
      })
      .from(companyGoals)
      .where(eq(companyGoals.companyId, this.runCtx.companyId));

    const metricsContext = recentMetrics
      .slice(0, 5)
      .map((m) => `MRR: ${m.mrr ?? "—"}, Revenue: ${m.totalRevenue ?? "—"}, Customers: ${m.totalCustomers}`)
      .join("\n");

    const goalsContext = activeGoals
      .map((g) => `${g.title}: ${g.currentValue} / ${g.targetValue} ${g.unit}`)
      .join("\n");

    const systemPrompt = this.buildSystemPrompt(FINANCE_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Generate a financial report for the past ${period}.

<external_data source="metrics_db">
Recent metrics:
${metricsContext || "No metrics recorded yet."}

Active goals:
${goalsContext || "No active goals."}
</external_data>

Analyze the financial health, identify growth rate, burn signals, and key insights.
Note any alerts that require founder attention.

Return ONLY this JSON:
{
  "period": "${period}",
  "mrrGrowthRate": 0.05,
  "burnRate": null,
  "runway": "18 months",
  "topRevenueDrivers": ["...", "..."],
  "costOptimizationOpportunities": ["...", "..."],
  "keyInsights": ["...", "..."],
  "alerts": [{"severity": "info|warning|critical", "message": "..."}]
}`,
      maxTokens: 2000,
    });

    const parsed = this.parseReport(result.content);

    const reportContent = [
      `Financial Report — ${parsed.period}`,
      "",
      parsed.keyInsights.map((i) => `- ${i}`).join("\n"),
      "",
      parsed.alerts.length > 0 ? `Alerts:\n${parsed.alerts.map((a) => `[${a.severity.toUpperCase()}] ${a.message}`).join("\n")}` : "No alerts.",
    ].join("\n");

    return {
      content: reportContent,
      summary: { period: parsed.period, alertCount: parsed.alerts.length, insightCount: parsed.keyInsights.length },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "financial_report",
      confidence: 0.85,
    };
  }

  private async analyzeBurn(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const recentMetrics = await db
      .select({ mrr: metrics.mrr, totalRevenue: metrics.totalRevenue, recordedAt: metrics.recordedAt })
      .from(metrics)
      .where(eq(metrics.companyId, this.runCtx.companyId))
      .orderBy(desc(metrics.recordedAt))
      .limit(10);

    const systemPrompt = this.buildSystemPrompt(FINANCE_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Analyze cash burn based on revenue trajectory.

<external_data source="metrics_db">
${recentMetrics.map((m) => `${m.recordedAt?.toISOString().split("T")[0]}: MRR ${m.mrr ?? "—"}, Revenue ${m.totalRevenue ?? "—"}`).join("\n")}
</external_data>

Estimate burn rate trend and runway if spending patterns continue. Flag any concerns.
Return a concise analysis in plain text.`,
      maxTokens: 1000,
    });

    return {
      content: result.content,
      summary: { analysisType: "burn" },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "burn_analysis",
      confidence: 0.75,
    };
  }

  private async analyzeRevenue(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { segment } = input.parameters as { segment?: string };

    const recentMetrics = await db
      .select({ mrr: metrics.mrr, totalRevenue: metrics.totalRevenue, totalCustomers: metrics.totalCustomers, recordedAt: metrics.recordedAt })
      .from(metrics)
      .where(eq(metrics.companyId, this.runCtx.companyId))
      .orderBy(desc(metrics.recordedAt))
      .limit(12);

    const systemPrompt = this.buildSystemPrompt(FINANCE_ROLE);

    const result = await this.callLlm({
      systemPrompt,
      userMessage: `Analyze revenue trends${segment ? ` for segment: ${segment}` : ""}.

<external_data source="metrics_db">
${recentMetrics.map((m) => `${m.recordedAt?.toISOString().split("T")[0]}: MRR ${m.mrr ?? "—"}, Revenue ${m.totalRevenue ?? "—"}, Customers ${m.totalCustomers}`).join("\n")}
</external_data>

Identify growth rate, trend direction, and any anomalies. Highlight what is driving or limiting revenue growth.
Return a concise analysis in plain text.`,
      maxTokens: 1200,
    });

    return {
      content: result.content,
      summary: { analysisType: "revenue", segment: segment ?? "all" },
      approvalRequired: false,
      ringLevel: 1,
      actionType: "revenue_analysis",
      confidence: 0.8,
    };
  }

  private parseReport(content: string): z.infer<typeof FinancialReportSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return FinancialReportSchema.parse(JSON.parse(match[0]));
    } catch {
      return {
        period: "unknown",
        topRevenueDrivers: [],
        costOptimizationOpportunities: [],
        keyInsights: [content.slice(0, 500)],
        alerts: [],
      };
    }
  }

  private periodToDate(period: string): Date {
    const days = parseInt(period.replace("d", ""), 10) || 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
}

const FINANCE_ROLE = `You analyze financial data and surface insights.
You report what you observe — you do not initiate actions, make purchases, send payments, or modify any data.
Your role is purely analytical. All decisions remain with the founder.`;
