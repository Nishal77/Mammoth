import type { Job } from "bullmq";
import {
  createAgentWorker,
  CeoBrainAgent,
  MarketingAgent,
  SalesAgent,
  SupportAgent,
  ResearchAgent,
  FinanceAgent,
  EngineeringAgent,
  HrAgent,
  ContentAgent,
  QUEUE_NAMES,
} from "@mammoth/agents";
import type { AgentJobData, AgentTaskOutput } from "@mammoth/agents";
import { db, departmentTasks, companies, publishSocketEvent } from "@mammoth/db";
import { eq } from "drizzle-orm";
import {
  expiryWorker,
  registerExpiryCheckJob,
} from "./approval-expiry-worker.ts";

const DEPARTMENT_AGENT_MAP: Record<
  string,
  () => { run: (ctx: import("@mammoth/agents").AgentRunContext, input: import("@mammoth/agents").AgentTaskInput) => Promise<AgentTaskOutput> }
> = {
  ceo: () => new CeoBrainAgent(),
  marketing: () => new MarketingAgent(),
  sales: () => new SalesAgent(),
  support: () => new SupportAgent(),
  research: () => new ResearchAgent(),
  finance: () => new FinanceAgent(),
  engineering: () => new EngineeringAgent(),
  hr: () => new HrAgent(),
  content: () => new ContentAgent(),
};

async function processJob(job: Job<AgentJobData>): Promise<void> {
  const { companyId, departmentId, taskId, agentRunId, taskType, parameters } =
    job.data;

  console.log(
    `[worker] Processing job ${job.id} | company=${companyId} taskType=${taskType}`
  );

  // Resolve department name from DB to pick the right agent
  const task = await db.query.departmentTasks.findFirst({
    where: eq(departmentTasks.id, taskId),
    with: {
      department: { columns: { name: true } },
    },
    columns: { id: true },
  });

  const deptName = task?.department?.name;
  if (!deptName) {
    throw new Error(`Task ${taskId} references unknown department ${departmentId}`);
  }

  const agentFactory = DEPARTMENT_AGENT_MAP[deptName];
  if (!agentFactory) {
    throw new Error(
      `No agent registered for department: ${deptName}. Supported: ${Object.keys(DEPARTMENT_AGENT_MAP).join(", ")}`
    );
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
    columns: { ownerId: true },
  });

  const ownerId = company?.ownerId;

  if (ownerId) {
    await publishSocketEvent(companyId, ownerId, {
      event: "task:started",
      taskId,
      department: deptName,
      title: taskType.replace(/_/g, " "),
    });
  }

  const agent = agentFactory();

  const output = await agent.run(
    { companyId, departmentId, taskId, agentRunId },
    { taskType, parameters }
  );

  if (ownerId) {
    const rawApprovalId = output.summary?.["approvalId"];

    await publishSocketEvent(companyId, ownerId, {
      event: "task:completed",
      taskId,
      department: deptName,
      outputPreview: output.content.slice(0, 200),
      ...(rawApprovalId ? { approvalId: String(rawApprovalId) } : {}),
    });
  }

  console.log(`[worker] Completed job ${job.id}`);
}

const worker = createAgentWorker(processJob);

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed successfully`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] Job ${job?.id} failed: ${error.message}`);
});

worker.on("error", (error) => {
  console.error("[worker] Worker error:", error);
});

// Register the repeatable expiry-check job (idempotent)
await registerExpiryCheckJob();

console.log(
  `[worker] Agent worker started. Listening on queue: ${QUEUE_NAMES.AGENT_TASKS}`
);
console.log("[worker] Approval expiry worker running — checks every 5 minutes");

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[worker] Received ${signal}, shutting down gracefully`);
  await Promise.all([worker.close(), expiryWorker.close()]);
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
