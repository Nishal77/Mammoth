import { db, companyGoals, metricsDaily } from "@mammoth/db";
import { eq, and, desc } from "drizzle-orm";

/**
 * Syncs companyGoals.currentValue from the latest metrics_daily MRR.
 * Graduates the goal to "achieved" when currentValue >= targetValue.
 * Called by CEO Brain after every strategy cycle.
 *
 * @param companyId - Company whose active goal to update
 */
export async function updateGoalProgress(companyId: string): Promise<void> {
  const activeGoal = await db.query.companyGoals.findFirst({
    where: and(
      eq(companyGoals.companyId, companyId),
      eq(companyGoals.status, "active")
    ),
    columns: { id: true, type: true, targetValue: true },
  });

  if (!activeGoal) return;

  // Only auto-sync revenue goals from MRR — other goal types require manual update
  if (activeGoal.type !== "revenue") return;

  const latestMetric = await db.query.metricsDaily.findFirst({
    where: eq(metricsDaily.companyId, companyId),
    orderBy: [desc(metricsDaily.date)],
    columns: { mrr: true },
  });

  if (!latestMetric?.mrr) return;

  const currentMrr = latestMetric.mrr;
  const isAchieved = Number(currentMrr) >= Number(activeGoal.targetValue);

  await db
    .update(companyGoals)
    .set({
      currentValue: currentMrr,
      status: isAchieved ? "achieved" : "active",
      updatedAt: new Date(),
    })
    .where(eq(companyGoals.id, activeGoal.id));
}
