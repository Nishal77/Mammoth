import { db, companyGoals, metricsDaily, departments, strategyDecisions } from "@mammoth/memory-database";
import { eq, and, desc, gte } from "drizzle-orm";
import type { CompanyCycleState, CompanySnapshot } from "../company-state.ts";

const METRICS_LOOKBACK_DAYS = 30;

/**
 * Snapshot node — first node in the CEO Brain planning graph.
 * Loads all company state from DB: goal progress, metrics, dept health, recent decisions.
 * Pure read — no LLM, no writes. Runs in ~50ms.
 */
export async function snapshotNode(
  state: CompanyCycleState
): Promise<Partial<CompanyCycleState>> {
  const { companyId } = state;

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - METRICS_LOOKBACK_DAYS);
  const fromDateStr = fromDate.toISOString().slice(0, 10);

  const [activeGoal, recentMetrics, deptStatuses, recentDecisions] = await Promise.all([
    db.query.companyGoals.findFirst({
      where: and(
        eq(companyGoals.companyId, companyId),
        eq(companyGoals.status, "active")
      ),
      columns: {
        title: true,
        unit: true,
        targetValue: true,
        currentValue: true,
        deadline: true,
      },
    }),
    db.query.metricsDaily.findMany({
      where: and(
        eq(metricsDaily.companyId, companyId),
        gte(metricsDaily.date, fromDateStr)
      ),
      orderBy: [desc(metricsDaily.date)],
      columns: {
        date: true,
        mrr: true,
        activeCustomers: true,
        newCustomers: true,
        churnedCustomers: true,
        aiCostUsd: true,
        tasksRun: true,
      },
      limit: 30,
    }),
    db.query.departments.findMany({
      where: eq(departments.companyId, companyId),
      columns: { name: true, status: true, lastRunAt: true },
    }),
    db.query.strategyDecisions.findMany({
      where: eq(strategyDecisions.companyId, companyId),
      orderBy: [desc(strategyDecisions.createdAt)],
      columns: { title: true, decision: true },
      limit: 5,
    }),
  ]);

  if (!activeGoal) {
    const snapshot: CompanySnapshot = {
      goalTitle: "",
      goalUnit: "",
      targetValue: 0,
      currentValue: 0,
      deadlineDate: "",
      progressPct: 0,
      latestMrr: 0,
      activeCustomers: 0,
      aiCostUsdToday: 0,
      tasksRunToday: 0,
      deptStatuses: deptStatuses.map((d) => ({
        name: d.name,
        status: d.status,
        lastRunAt: d.lastRunAt ? d.lastRunAt.toISOString() : null,
      })),
      recentDecisions: recentDecisions.map((d) => ({
        title: d.title,
        decision: d.decision.slice(0, 200),
      })),
      hasActiveGoal: false,
    };
    return { snapshot };
  }

  const latestMetric = recentMetrics[0];
  const today = new Date().toISOString().slice(0, 10);
  const todayMetric = recentMetrics.find((m) => m.date === today);

  const targetNum = Number(activeGoal.targetValue);
  const currentNum = Number(activeGoal.currentValue);
  const progressPct = targetNum > 0 ? Math.round((currentNum / targetNum) * 100) : 0;

  const snapshot: CompanySnapshot = {
    goalTitle: activeGoal.title,
    goalUnit: activeGoal.unit,
    targetValue: targetNum,
    currentValue: currentNum,
    deadlineDate: activeGoal.deadline ?? "",
    progressPct,
    latestMrr: Number(latestMetric?.mrr ?? 0),
    activeCustomers: latestMetric?.activeCustomers ?? 0,
    aiCostUsdToday: Number(todayMetric?.aiCostUsd ?? 0),
    tasksRunToday: todayMetric?.tasksRun ?? 0,
    deptStatuses: deptStatuses.map((d) => ({
      name: d.name,
      status: d.status,
      lastRunAt: d.lastRunAt ? d.lastRunAt.toISOString() : null,
    })),
    recentDecisions: recentDecisions.map((d) => ({
      title: d.title,
      decision: d.decision.slice(0, 200),
    })),
    hasActiveGoal: true,
  };

  return { snapshot };
}
