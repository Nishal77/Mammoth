import { z } from "zod";
import {
  db,
  briefings,
  companyGoals,
  metricsDaily,
  strategyDecisions,
  companies,
} from "@mammoth/memory-database";
import { eq, and, desc, gte } from "drizzle-orm";
import { callModel, MODELS } from "@mammoth/agent-base";
import { publishNotification } from "@mammoth/memory-database";

const BriefingOutputSchema = z.object({
  summary: z.string(),
  yesterdayHighlights: z.string(),
  todayPlans: z.string(),
  attentionItems: z.string(),
});

/**
 * Generates and persists a founder briefing. Skips if one was already
 * generated today for this type. Notifies the founder via Redis pub/sub.
 *
 * @param companyId - Target company
 * @param briefingType - "daily" (default) or "weekly"
 */
export async function generateBriefing(
  companyId: string,
  briefingType: "daily" | "weekly" = "daily"
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const existing = await db.query.briefings.findFirst({
    where: and(
      eq(briefings.companyId, companyId),
      eq(briefings.briefingDate, today),
      eq(briefings.briefingType, briefingType)
    ),
    columns: { id: true },
  });
  if (existing) return;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = sevenDaysAgo.toISOString().slice(0, 10);

  const [company, activeGoal, recentMetrics, recentDecisions] = await Promise.all([
    db.query.companies.findFirst({
      where: eq(companies.id, companyId),
      columns: { name: true, ownerId: true },
    }),
    db.query.companyGoals.findFirst({
      where: and(
        eq(companyGoals.companyId, companyId),
        eq(companyGoals.status, "active")
      ),
      columns: {
        title: true,
        targetValue: true,
        currentValue: true,
        unit: true,
        deadline: true,
      },
    }),
    db.query.metricsDaily.findMany({
      where: and(
        eq(metricsDaily.companyId, companyId),
        gte(metricsDaily.date, fromDate)
      ),
      orderBy: [desc(metricsDaily.date)],
      limit: 7,
      columns: {
        date: true,
        mrr: true,
        activeCustomers: true,
        newCustomers: true,
        churnedCustomers: true,
        aiCostUsd: true,
        tasksRun: true,
      },
    }),
    db.query.strategyDecisions.findMany({
      where: and(
        eq(strategyDecisions.companyId, companyId),
        gte(strategyDecisions.createdAt, sevenDaysAgo)
      ),
      orderBy: [desc(strategyDecisions.createdAt)],
      limit: 5,
      columns: { title: true, decision: true },
    }),
  ]);

  if (!company) return;

  const metricsText = recentMetrics
    .map(
      (m) =>
        `${m.date}: MRR $${m.mrr ?? 0} | Customers ${m.activeCustomers ?? 0} | New ${m.newCustomers ?? 0} | Churned ${m.churnedCustomers ?? 0} | AI cost $${m.aiCostUsd ?? 0} | Tasks ${m.tasksRun ?? 0}`
    )
    .join("\n");

  const decisionsText = recentDecisions
    .map((d) => `- ${d.title}: ${d.decision.slice(0, 200)}`)
    .join("\n");

  const goalText = activeGoal
    ? `Goal: ${activeGoal.title} — ${activeGoal.currentValue} / ${activeGoal.targetValue} ${activeGoal.unit} (deadline: ${activeGoal.deadline})`
    : "No active goal.";

  const result = await callModel({
    model: MODELS.HAIKU,
    companyId,
    systemPrompt: `You generate concise founder briefings. Be direct and specific. No filler or pleasantries.`,
    messages: [
      {
        role: "user",
        content: `Generate a ${briefingType} briefing for ${company.name}.

${goalText}

Metrics (last 7 days):
${metricsText || "No metrics yet."}

Recent strategic decisions:
${decisionsText || "No recent decisions."}

Return ONLY this JSON:
{
  "summary": "2-3 sentence company health summary",
  "yesterdayHighlights": "key wins and actions from the past period",
  "todayPlans": "what the AI departments are focused on today",
  "attentionItems": "what requires founder attention right now"
}`,
      },
    ],
    maxTokens: 1500,
  });

  const parsed = parseBriefingOutput(result.content);

  const [savedBriefing] = await db
    .insert(briefings)
    .values({
      companyId,
      briefingDate: today,
      briefingType,
      summary: parsed.summary,
      fullContent: result.content,
      yesterdayHighlights: parsed.yesterdayHighlights,
      todayPlans: parsed.todayPlans,
      attentionItems: parsed.attentionItems,
    })
    .returning({ id: briefings.id });

  await publishNotification({
    type: "briefing_ready",
    userId: company.ownerId,
    briefingId: savedBriefing!.id,
  });
}

function parseBriefingOutput(
  content: string
): z.infer<typeof BriefingOutputSchema> {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");
    return BriefingOutputSchema.parse(JSON.parse(match[0]));
  } catch {
    return {
      summary: content.slice(0, 500),
      yesterdayHighlights: "",
      todayPlans: "",
      attentionItems: "Unable to parse briefing — review manually.",
    };
  }
}
