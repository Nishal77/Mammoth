// Observability init must come first — before BullMQ workers are created —
// so OTel can instrument Redis and the Sentry error handler is active.
import { initSentry, captureError, flushSentry } from "@mammoth/observability/sentry";
import { initTracing, shutdownTracing } from "@mammoth/observability/tracing";
import { createLogger } from "@mammoth/observability/logger";
import { publishToDlq } from "@mammoth/observability/dead-letter-queue";

initSentry({
  dsn: process.env["SENTRY_DSN"],
  serviceName: "agent-worker",
  environment: process.env["NODE_ENV"] ?? "development",
});

initTracing({
  serviceName: "mammoth-agent-worker",
  serviceVersion: process.env["SERVICE_VERSION"] ?? "0.0.1",
  collectorUrl: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
});

const log = createLogger("agent-worker");

import type { Job } from "bullmq";
import { createAgentWorker, QUEUE_NAMES, BaseAgent } from "@mammoth/agent-base";
import type { AgentJobData, AgentTaskOutput, AgentRunContext, AgentTaskInput } from "@mammoth/agent-base";
import { PolicyViolationError } from "@mammoth/eval-policy";
import { CeoBrainAgent } from "@mammoth/agent-executive";
import { MarketingAgent } from "@mammoth/agent-marketing";
import { SalesAgent } from "@mammoth/agent-sales";
import { SupportAgent } from "@mammoth/agent-support";
import { ResearchAgent } from "@mammoth/agent-research";
import { FinanceAgent } from "@mammoth/agent-finance";
import { EngineeringAgent } from "@mammoth/agent-engineering";
import { HrAgent } from "@mammoth/agent-hr";
import { ContentAgent } from "@mammoth/agent-content";
import { db, departmentTasks, companies, publishSocketEvent } from "@mammoth/memory-database";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import {
  expiryWorker,
  registerExpiryCheckJob,
} from "./approval-expiry-worker.ts";
import { executionWorker } from "./action-execution-worker.ts";

// Shared Redis connection used for DLQ publishing.
const redis = new Redis({
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
});

const DEPARTMENT_AGENT_MAP: Record<string, () => BaseAgent> = {
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
  const { companyId, departmentId, taskId, agentRunId, taskType, parameters } = job.data;

  const jobLog = log.withContext({ companyId, agentRunId, taskId, actionType: taskType });
  jobLog.info(`Processing job ${job.id}`);

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

  // Dead-letter any job whose agent bypasses the policy gate by not extending BaseAgent.
  if (!(agent instanceof BaseAgent)) {
    throw new PolicyViolationError(
      `Agent for department "${deptName}" does not extend BaseAgent — policy gate missing`,
      "AGENT_NOT_BASE_AGENT"
    );
  }

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

  jobLog.info(`Completed job ${job.id}`);
}

const worker = createAgentWorker(processJob);

worker.on("completed", (job) => {
  log.info(`Job completed`, { actionType: job.id ?? "unknown" });
});

worker.on("failed", (job, error) => {
  const jobLog = log.withContext({
    companyId: job?.data?.companyId ?? "unknown",
    agentRunId: job?.data?.agentRunId ?? "unknown",
    taskId: job?.data?.taskId ?? "unknown",
    actionType: job?.data?.taskType ?? "unknown",
  });

  jobLog.errorWithStack(`Job failed after ${job?.attemptsMade ?? 0} attempts`, error);

  captureError(error, {
    jobId: job?.id ?? "unknown",
    companyId: job?.data?.companyId ?? "unknown",
    agentRunId: job?.data?.agentRunId ?? "unknown",
    taskType: job?.data?.taskType ?? "unknown",
    attemptsMade: job?.attemptsMade ?? 0,
  });

  if (job) {
    void publishToDlq(
      { host: process.env["REDIS_HOST"] ?? "localhost", port: Number(process.env["REDIS_PORT"] ?? 6379), maxRetriesPerRequest: null },
      QUEUE_NAMES.AGENT_TASKS,
      job,
      error
    ).catch((dlqError) => {
      log.errorWithStack("Failed to publish job to DLQ", dlqError as Error, {
        jobId: job.id ?? "unknown",
      });
    });
  }
});

worker.on("error", (error) => {
  log.errorWithStack("Worker-level error (connection issue)", error);
  captureError(error, { type: "worker_error" });
});

await registerExpiryCheckJob();

log.info(`Agent worker started`, { queue: QUEUE_NAMES.AGENT_TASKS });
log.info("Approval expiry worker running — checks every 5 minutes");
log.info("Action execution worker running — dispatches approved actions");

const shutdown = async (signal: string): Promise<void> => {
  log.info(`Received ${signal}, shutting down gracefully`);
  await Promise.all([
    worker.close(),
    expiryWorker.close(),
    executionWorker.close(),
    redis.quit(),
    flushSentry(),
    shutdownTracing(),
  ]);
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
