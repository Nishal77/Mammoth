import { db, metricsDaily, companies, users } from "@mammoth/memory-database";
import { and, eq, sql } from "drizzle-orm";
import { getPlan } from "./plan-definitions.ts";

export type BudgetCheckResult =
  | { allowed: true; remainingUsd: number }
  | { allowed: false; reason: string; spentUsd: number; limitUsd: number };

/**
 * Checks whether a company is within its daily AI spending budget.
 * Called by agent workers before making any LLM API call.
 *
 * Returns allowed=false if:
 * - The company has no active goal (nothing to work toward)
 * - Today's AI cost already reached the plan's daily cap
 *
 * @param companyId - The company to check
 */
export async function checkDailyBudget(companyId: string): Promise<BudgetCheckResult> {
  // Load the company's owner to get their plan tier
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
    columns: { ownerId: true },
  });

  if (!company) {
    return { allowed: false, reason: "Company not found", spentUsd: 0, limitUsd: 0 };
  }

  const owner = await db.query.users.findFirst({
    where: eq(users.id, company.ownerId),
    columns: { plan: true },
  });

  const plan = getPlan(owner?.plan ?? "free");
  const limitUsd = plan.maxAiCostPerDayUsd;

  if (limitUsd === Infinity) {
    return { allowed: true, remainingUsd: Infinity };
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  const todayRow = await db.query.metricsDaily.findFirst({
    where: and(
      eq(metricsDaily.companyId, companyId),
      eq(metricsDaily.date, todayStr)
    ),
    columns: { aiCostUsd: true },
  });

  const spentUsd = parseFloat(String(todayRow?.aiCostUsd ?? "0"));

  if (spentUsd >= limitUsd) {
    return {
      allowed: false,
      reason: `Daily AI cost cap of $${limitUsd} reached ($${spentUsd.toFixed(4)} spent)`,
      spentUsd,
      limitUsd,
    };
  }

  return { allowed: true, remainingUsd: limitUsd - spentUsd };
}

/**
 * Records an AI cost against today's metrics row.
 * Upserts the row — safe to call even if no metrics row exists yet for today.
 *
 * @param companyId - The company being charged
 * @param costUsd   - The amount to add (e.g. 0.0012 for a Haiku call)
 */
export async function recordAiCost(companyId: string, costUsd: number): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const costStr = costUsd.toFixed(6);

  await db
    .insert(metricsDaily)
    .values({
      companyId,
      date: todayStr,
      aiCostUsd: costStr,
      tasksRun: 1,
    })
    .onConflictDoUpdate({
      target: [metricsDaily.companyId, metricsDaily.date],
      set: {
        aiCostUsd: sql`${metricsDaily.aiCostUsd}::numeric + ${costStr}::numeric`,
        tasksRun: sql`${metricsDaily.tasksRun} + 1`,
      },
    });
}

/**
 * Returns the total AI cost spent today for a company.
 * Used by monitoring dashboards and billing alerts.
 *
 * @param companyId - The company to check
 */
export async function getDailyAiCost(companyId: string): Promise<number> {
  const todayStr = new Date().toISOString().slice(0, 10);

  const row = await db.query.metricsDaily.findFirst({
    where: and(
      eq(metricsDaily.companyId, companyId),
      eq(metricsDaily.date, todayStr)
    ),
    columns: { aiCostUsd: true },
  });

  return parseFloat(String(row?.aiCostUsd ?? "0"));
}
