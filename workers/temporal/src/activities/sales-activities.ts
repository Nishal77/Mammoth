/**
 * Temporal activities for the sales cycle workflow.
 *
 * Activities are the "real work" functions — they interact with external systems
 * (databases, queues, APIs). Temporal retries them automatically on failure.
 *
 * Each activity is a plain async function. The Temporal worker registers them
 * and the workflow calls them via proxyActivities.
 */

import { db, departmentTasks, departments, leads, agentRuns } from "@mammoth/memory-database";
import { eq, and, desc } from "drizzle-orm";
import { Queue } from "bullmq";
import type { AgentJobData } from "./agent-job-data.ts";

const QUEUE_NAME = "agent:tasks";

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

/**
 * Queues a lead_research task and returns the task ID.
 * Sales agent searches Apollo for leads matching the ICP.
 */
export async function queueLeadResearch(companyId: string, icp: string, count = 10): Promise<string> {
  const dept = await getSalesDept(companyId);

  const [run] = await db.insert(agentRuns).values({
    companyId,
    department: "sales",
    runType: "triggered",
    triggerSource: "temporal:sales_cycle",
    status: "running",
    tasksCreated: 1,
  }).returning({ id: agentRuns.id });

  const [task] = await db.insert(departmentTasks).values({
    companyId,
    departmentId: dept.id,
    title: `Lead research: ${icp.slice(0, 80)}`,
    taskType: "lead_research",
    status: "queued",
    inputData: { icp, count },
  }).returning({ id: departmentTasks.id });

  if (!task || !run) throw new Error("Failed to create task/run");

  const queue = new Queue<AgentJobData>(QUEUE_NAME, { connection: REDIS_CONNECTION });
  await queue.add("lead_research", {
    companyId,
    departmentId: dept.id,
    taskId: task.id,
    agentRunId: run.id,
    taskType: "lead_research",
    parameters: { icp, count },
  });
  await queue.close();

  return task.id;
}

/**
 * Waits until the lead_research task is completed.
 * Polls every 30s — Temporal retries this activity until it succeeds.
 */
export async function waitForLeadResearch(taskId: string): Promise<string[]> {
  const task = await db.query.departmentTasks.findFirst({
    where: eq(departmentTasks.id, taskId),
    columns: { status: true, outputData: true },
  });

  if (!task || task.status === "failed") {
    throw new Error(`Lead research task ${taskId} failed`);
  }

  if (task.status !== "completed") {
    throw new Error(`Lead research task ${taskId} still running (status: ${task.status})`);
  }

  // Return list of lead IDs created by the task
  const leadRows = await db.query.leads.findMany({
    where: and(
      eq(leads.status, "new"),
    ),
    columns: { id: true },
    orderBy: [desc(leads.createdAt)],
    limit: 25,
  });

  return leadRows.map((l) => l.id);
}

/**
 * Queues an outreach_sequence task for a single lead.
 * Returns the task ID.
 */
export async function queueOutreachSequence(companyId: string, leadId: string): Promise<string> {
  const dept = await getSalesDept(companyId);

  const [run] = await db.insert(agentRuns).values({
    companyId,
    department: "sales",
    runType: "triggered",
    triggerSource: "temporal:sales_cycle",
    status: "running",
    tasksCreated: 1,
  }).returning({ id: agentRuns.id });

  const [task] = await db.insert(departmentTasks).values({
    companyId,
    departmentId: dept.id,
    title: `Outreach sequence: lead ${leadId.slice(0, 8)}`,
    taskType: "outreach_sequence",
    status: "queued",
    inputData: { leadId },
  }).returning({ id: departmentTasks.id });

  if (!task || !run) throw new Error("Failed to create outreach task");

  const queue = new Queue<AgentJobData>(QUEUE_NAME, { connection: REDIS_CONNECTION });
  await queue.add("outreach_sequence", {
    companyId,
    departmentId: dept.id,
    taskId: task.id,
    agentRunId: run.id,
    taskType: "outreach_sequence",
    parameters: { leadId },
  });
  await queue.close();

  return task.id;
}

/**
 * Checks whether a lead has responded (i.e. status updated to CONTACTED or REPLIED).
 * If not responded, returns false — the workflow will wait and retry.
 */
export async function checkLeadResponded(leadId: string): Promise<boolean> {
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, leadId),
    columns: { status: true },
  });

  return lead?.status === "contacted" || lead?.status === "replied";
}

/**
 * Updates a lead's status in the DB.
 * Called at the end of the sales cycle to mark leads as processed.
 */
export async function updateLeadStatus(leadId: string, status: string): Promise<void> {
  await db
    .update(leads)
    .set({ status, updatedAt: new Date() })
    .where(eq(leads.id, leadId));
}

// ---- helpers ----

async function getSalesDept(companyId: string): Promise<{ id: string }> {
  const dept = await db.query.departments.findFirst({
    where: and(eq(departments.companyId, companyId), eq(departments.name, "sales")),
    columns: { id: true },
  });
  if (!dept) throw new Error(`Sales department not found for company ${companyId}`);
  return dept;
}
