import { z } from "zod";
import { db, companyGoals, departments, metricsDaily, strategyDecisions } from "@mammoth/db";
import { eq, and, desc, gte } from "drizzle-orm";
import { BaseAgent } from "../base/base-agent.ts";
import { MODELS } from "../router/model-router.ts";
import { upsertMemory } from "../memory/memory-writer.ts";
import { updateGoalProgress } from "../goal/goal-progress-tracker.ts";
import { generateBriefing } from "../goal/briefing-generator.ts";
import { dispatchDepartmentTasks } from "../orchestration/department-dispatcher.ts";
import type { AgentTaskInput, AgentTaskOutput } from "../base/base-agent.ts";

const CeoOutputSchema = z.object({
  situationSummary: z.string(),
  isOnTrack: z.boolean(),
  topConstraint: z.string(),
  priorities: z.array(
    z.object({
      department: z.string(),
      focus: z.string(),
      weeklyTarget: z.string(),
    })
  ),
  decisionsNeeded: z.array(
    z.object({
      description: z.string(),
      recommendation: z.string(),
      requiresApproval: z.boolean(),
    })
  ),
  marketAlerts: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

type CeoOutput = z.infer<typeof CeoOutputSchema>;

/**
 * CEO Brain Agent — runs every 6h.
 * Analyzes company metrics, sets department priorities, detects pivots.
 * Uses Claude Sonnet for complex multi-step strategic reasoning.
 */
export class CeoBrainAgent extends BaseAgent {
  constructor() {
    super("CEO Brain", MODELS.SONNET);
  }

  protected async execute(_input: AgentTaskInput): Promise<AgentTaskOutput> {
    const snapshot = await this.loadCompanySnapshot();
    const systemPrompt = this.buildSystemPrompt(CEO_ROLE_DESCRIPTION);

    const userMessage = this.buildAnalysisPrompt(snapshot);

    const result = await this.callLlm({
      systemPrompt,
      userMessage,
      maxTokens: 8192,
    });

    const parsed = this.parseOutput(result.content);

    await this.saveStrategyDecision(parsed);

    // Update goal currentValue from latest MRR; graduate if target is hit
    await updateGoalProgress(this.runCtx.companyId);

    // Persist department priorities to memory — future agents read these as context
    await this.savePrioritiesToMemory(parsed.priorities);

    // Dispatch tasks to each department based on CEO priorities
    // Non-blocking — dispatch failure must not fail the CEO Brain run itself
    void dispatchDepartmentTasks(this.runCtx.companyId, parsed.priorities).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error("[ceo-brain] Department dispatch failed:", msg);
    });

    // Generate daily briefing (no-op if already done today)
    void generateBriefing(this.runCtx.companyId, "daily");

    // Generate weekly briefing on Mondays (no-op if already done this week)
    if (new Date().getDay() === 1) {
      void generateBriefing(this.runCtx.companyId, "weekly");
    }

    return {
      content: result.content,
      summary: {
        isOnTrack: parsed.isOnTrack,
        topConstraint: parsed.topConstraint,
        priorityCount: parsed.priorities.length,
        decisionsNeeded: parsed.decisionsNeeded.length,
      },
      approvalRequired: parsed.decisionsNeeded.some((d) => d.requiresApproval),
      ringLevel: parsed.isOnTrack ? 1 : 2,
      actionType: "ceo_strategy_cycle",
      confidence: parsed.confidence,
    };
  }

  private async loadCompanySnapshot(): Promise<CompanySnapshot> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().slice(0, 10);

    const [activeGoal, recentMetrics, deptStatuses, recentDecisions] =
      await Promise.all([
        db.query.companyGoals.findFirst({
          where: and(
            eq(companyGoals.companyId, this.runCtx.companyId),
            eq(companyGoals.status, "active")
          ),
        }),
        db.query.metricsDaily.findMany({
          where: and(
            eq(metricsDaily.companyId, this.runCtx.companyId),
            gte(metricsDaily.date, fromDate)
          ),
          orderBy: [desc(metricsDaily.date)],
          limit: 30,
        }),
        db.query.departments.findMany({
          where: eq(departments.companyId, this.runCtx.companyId),
          columns: { name: true, status: true, lastRunAt: true },
        }),
        db.query.strategyDecisions.findMany({
          where: eq(strategyDecisions.companyId, this.runCtx.companyId),
          orderBy: [desc(strategyDecisions.createdAt)],
          limit: 5,
          columns: { title: true, decision: true, createdAt: true },
        }),
      ]);

    return { activeGoal, recentMetrics, deptStatuses, recentDecisions };
  }

  private buildAnalysisPrompt(snapshot: CompanySnapshot): string {
    const today = new Date().toISOString().slice(0, 10);
    const latestMetric = snapshot.recentMetrics[0];

    const goalSection = snapshot.activeGoal
      ? `ACTIVE GOAL: ${snapshot.activeGoal.title}
  Target: ${snapshot.activeGoal.targetValue} ${snapshot.activeGoal.unit}
  Current: ${snapshot.activeGoal.currentValue} ${snapshot.activeGoal.unit}
  Deadline: ${snapshot.activeGoal.deadline}
  Progress: ${Math.round((Number(snapshot.activeGoal.currentValue) / Number(snapshot.activeGoal.targetValue)) * 100)}%`
      : "NO ACTIVE GOAL SET — recommend the founder set a goal first.";

    const metricsSection = latestMetric
      ? `LATEST METRICS (${latestMetric.date}):
  MRR: $${latestMetric.mrr ?? 0}
  Active Customers: ${latestMetric.activeCustomers ?? 0}
  New Customers This Month: ${latestMetric.newCustomers ?? 0}
  Churned: ${latestMetric.churnedCustomers ?? 0}
  AI Cost Today: $${latestMetric.aiCostUsd ?? 0}
  Tasks Run: ${latestMetric.tasksRun ?? 0}`
      : "No metrics data yet — first cycle.";

    const deptSection = snapshot.deptStatuses
      .map((d) => `  ${d.name}: ${d.status} (last run: ${d.lastRunAt ?? "never"})`)
      .join("\n");

    const recentDecisionsSection =
      snapshot.recentDecisions.length > 0
        ? snapshot.recentDecisions
            .map((d) => `  - ${d.title}: ${d.decision.slice(0, 150)}`)
            .join("\n")
        : "  No prior decisions.";

    return `Perform your CEO Brain cycle for today (${today}).

${goalSection}

${metricsSection}

DEPARTMENT STATUS:
${deptSection}

RECENT STRATEGIC DECISIONS:
${recentDecisionsSection}

Analyze the situation and produce a JSON response matching this exact schema:
{
  "situationSummary": "2-3 sentence company health summary",
  "isOnTrack": true/false,
  "topConstraint": "The single biggest thing blocking goal attainment",
  "priorities": [
    { "department": "marketing|sales|engineering|support|finance|research|hr|content", "focus": "what to focus on this week", "weeklyTarget": "specific measurable target" }
  ],
  "decisionsNeeded": [
    { "description": "what decision is needed", "recommendation": "what you recommend", "requiresApproval": true/false }
  ],
  "marketAlerts": ["any competitor or market signals worth noting"],
  "confidence": 0.0-1.0
}

Return ONLY the JSON object. No explanation.`;
  }

  private parseOutput(content: string): CeoOutput {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in output");

      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      return CeoOutputSchema.parse(parsed);
    } catch {
      // Return a safe fallback if parsing fails
      return {
        situationSummary: content.slice(0, 500),
        isOnTrack: false,
        topConstraint: "Unable to parse strategy output — review manually",
        priorities: [],
        decisionsNeeded: [],
        marketAlerts: [],
        confidence: 0.3,
      };
    }
  }

  /**
   * Persists CEO Brain priorities to company memory as playbook_refinement entries.
   * Each department agent reads these on its next run via the memory-loader.
   */
  private async savePrioritiesToMemory(
    priorities: CeoOutput["priorities"]
  ): Promise<void> {
    const week = new Date().toISOString().slice(0, 10);
    await Promise.all(
      priorities.map((p) =>
        upsertMemory({
          companyId: this.runCtx.companyId,
          memoryType: "playbook_refinement",
          key: `${p.department}:weekly_priority:${week}`,
          value: `Focus: ${p.focus}\nWeekly target: ${p.weeklyTarget}`,
          source: "agent:ceo_brain",
          confidence: 0.9,
        }).catch(() => undefined)
      )
    );
  }

  private async saveStrategyDecision(output: CeoOutput): Promise<void> {
    await db.insert(strategyDecisions).values({
      companyId: this.runCtx.companyId,
      title: `CEO Brain Cycle — ${new Date().toISOString().slice(0, 10)}`,
      decision: output.situationSummary,
      reasoning: JSON.stringify({
        isOnTrack: output.isOnTrack,
        topConstraint: output.topConstraint,
        priorities: output.priorities,
        marketAlerts: output.marketAlerts,
      }),
      madeBy: "ai",
      sourceAgent: "ceo_brain",
      tags: ["strategy", "cycle", output.isOnTrack ? "on-track" : "off-track"],
    });
  }
}

type CompanySnapshot = {
  activeGoal: typeof companyGoals.$inferSelect | undefined;
  recentMetrics: (typeof metricsDaily.$inferSelect)[];
  deptStatuses: { name: string; status: string; lastRunAt: Date | null }[];
  recentDecisions: {
    title: string;
    decision: string;
    createdAt: Date;
  }[];
};

const CEO_ROLE_DESCRIPTION = `You are the strategic intelligence layer of an autonomous company.
Your job: analyze company metrics against the active goal, identify the highest-leverage opportunities,
assign clear weekly priorities to each department, and flag any decisions requiring the founder's input.

Think like a world-class CEO with deep knowledge of the company. Be specific and actionable.
Prioritize revenue-generating actions. Detect pivot signals early. Keep founder overhead to a minimum.`;
