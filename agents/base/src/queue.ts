import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";

export const QUEUE_NAMES = {
  AGENT_TASKS: "agent:tasks",
  SCHEDULER: "agent:scheduler",
  NOTIFICATIONS: "notifications",
} as const;

export type AgentJobData = {
  companyId: string;
  departmentId: string;
  taskId: string;
  agentRunId: string;
  taskType: string;
  parameters: Record<string, unknown>;
};

// BullMQ ConnectionOptions — host/port is simpler and avoids IORedis type friction.
// maxRetriesPerRequest: null is required by BullMQ for blocking Redis commands.
function buildRedisConnection(): ConnectionOptions {
  return {
    host: process.env["REDIS_HOST"] ?? "localhost",
    port: Number(process.env["REDIS_PORT"] ?? 6379),
    password: process.env["REDIS_PASSWORD"] ?? undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * The main agent task queue. All department agent jobs go through here.
 * BullMQ concurrency is set per-company to prevent cost amplification.
 */
export function createAgentQueue(): Queue<AgentJobData> {
  return new Queue<AgentJobData>(QUEUE_NAMES.AGENT_TASKS, {
    connection: buildRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    },
  });
}

/**
 * Enqueues an agent task for async execution.
 * Returns the BullMQ job ID for tracking.
 */
export async function enqueueAgentTask(
  queue: Queue<AgentJobData>,
  data: AgentJobData
): Promise<string> {
  const jobName = `${data.taskType}:${data.companyId}`;

  const job = await queue.add(jobName, data, {
    jobId: data.taskId,
  });

  return job.id ?? data.taskId;
}

/**
 * Creates the agent worker that processes tasks from the queue.
 * Concurrency of 5 means up to 5 tasks execute simultaneously.
 */
export function createAgentWorker(
  processJob: (job: Job<AgentJobData>) => Promise<void>
): Worker<AgentJobData> {
  return new Worker<AgentJobData>(QUEUE_NAMES.AGENT_TASKS, processJob, {
    connection: buildRedisConnection(),
    concurrency: 5,
  });
}
