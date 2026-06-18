import { Worker, type Job } from "bullmq";
import { db, departments, departmentTasks, agentRuns } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";
import { enqueueAgentTask, createAgentQueue } from "@mammoth/agent-base";
import type { AgentJobData } from "@mammoth/agent-base";
import { runCompanyCycle } from "@mammoth/orchestrator-dispatcher";
import { createLogger } from "@mammoth/observability/logger";
import { SCHEDULER_QUEUE_NAME, JOB_NAMES } from "./cron-definitions.ts";
import type { SchedulerJobData } from "./cron-definitions.ts";

const log = createLogger("scheduler-worker");

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

/**
 * Handles a CEO Brain cycle job.
 * Runs the full LangGraph planning graph: snapshot → analysis → priorities → dispatch.
 */
async function handleCeoBrainCycle(companyId: string): Promise<void> {
  const result = await runCompanyCycle(companyId);

  if (result.error) {
    log.warn("CEO Brain cycle error", { companyId, error: result.error });
    return;
  }

  log.info("CEO Brain cycle finished", {
    companyId,
    dispatched: result.dispatched,
    isOnTrack: result.isOnTrack,
    shouldPivot: result.shouldPivot,
    durationMs: result.durationMs,
  });
}

/**
 * Handles a Research cycle job.
 * Queues a competitor_intel task for the Research department.
 * Runs every 12h so CEO Brain always has fresh competitor context.
 */
async function handleResearchCycle(companyId: string): Promise<void> {
  const dept = await db.query.departments.findFirst({
    where: and(
      eq(departments.companyId, companyId),
      eq(departments.name, "research"),
      eq(departments.status, "active")
    ),
    columns: { id: true },
  });

  if (!dept) {
    log.warn("Research department not active — skipping cycle", { companyId });
    return;
  }

  const [run] = await db
    .insert(agentRuns)
    .values({
      companyId,
      department: "research",
      runType: "scheduled",
      triggerSource: "research_cron",
      status: "running",
      tasksCreated: 1,
    })
    .returning({ id: agentRuns.id });

  if (!run) return;

  const [task] = await db
    .insert(departmentTasks)
    .values({
      companyId,
      departmentId: dept.id,
      title: "Scheduled competitor intel scan",
      taskType: "competitor_intel",
      status: "queued",
      inputData: {},
    })
    .returning({ id: departmentTasks.id });

  if (!task) return;

  const jobData: AgentJobData = {
    companyId,
    departmentId: dept.id,
    taskId: task.id,
    agentRunId: run.id,
    taskType: "competitor_intel",
    parameters: {},
  };

  const agentQueue = createAgentQueue();
  await enqueueAgentTask(agentQueue, jobData);
  await agentQueue.close();

  log.info("Research cycle queued", { companyId, taskId: task.id });
}

/**
 * Handles a Finance cycle job.
 * Queues a financial_report task. Finance is read-only — pulls Stripe data,
 * updates metricsDaily, ready for CEO Brain's next snapshot.
 */
async function handleFinanceCycle(companyId: string): Promise<void> {
  const dept = await db.query.departments.findFirst({
    where: and(
      eq(departments.companyId, companyId),
      eq(departments.name, "finance"),
      eq(departments.status, "active")
    ),
    columns: { id: true },
  });

  if (!dept) {
    log.warn("Finance department not active — skipping cycle", { companyId });
    return;
  }

  const [run] = await db
    .insert(agentRuns)
    .values({
      companyId,
      department: "finance",
      runType: "scheduled",
      triggerSource: "finance_cron",
      status: "running",
      tasksCreated: 1,
    })
    .returning({ id: agentRuns.id });

  if (!run) return;

  const [task] = await db
    .insert(departmentTasks)
    .values({
      companyId,
      departmentId: dept.id,
      title: "Scheduled financial report",
      taskType: "financial_report",
      status: "queued",
      inputData: {},
    })
    .returning({ id: departmentTasks.id });

  if (!task) return;

  const jobData: AgentJobData = {
    companyId,
    departmentId: dept.id,
    taskId: task.id,
    agentRunId: run.id,
    taskType: "financial_report",
    parameters: {},
  };

  const agentQueue = createAgentQueue();
  await enqueueAgentTask(agentQueue, jobData);
  await agentQueue.close();

  log.info("Finance cycle queued", { companyId, taskId: task.id });
}

async function processSchedulerJob(job: Job<SchedulerJobData>): Promise<void> {
  const { companyId, jobName } = job.data;
  const jobLog = log.withContext({ companyId, actionType: jobName });

  jobLog.info(`Processing scheduled job: ${jobName}`);

  switch (jobName) {
    case JOB_NAMES.CEO_BRAIN_CYCLE:
      await handleCeoBrainCycle(companyId);
      break;
    case JOB_NAMES.RESEARCH_CYCLE:
      await handleResearchCycle(companyId);
      break;
    case JOB_NAMES.FINANCE_CYCLE:
      await handleFinanceCycle(companyId);
      break;
    default:
      jobLog.warn(`Unknown scheduler job name: ${String(jobName)}`);
  }
}

export function createSchedulerWorker(): Worker<SchedulerJobData> {
  return new Worker<SchedulerJobData>(
    SCHEDULER_QUEUE_NAME,
    processSchedulerJob,
    {
      connection: REDIS_CONNECTION,
      // Low concurrency — each cycle triggers LLM calls; no thundering herd
      concurrency: 3,
    }
  );
}
