import { Queue, Worker, type Job } from "bullmq";
import { synthesizeDepartmentPlaybook, findDepartmentsReadyToLearn } from "@mammoth/agent-base";
import { createLogger } from "@mammoth/observability/logger";

const log = createLogger("learning-worker");

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

export const LEARNING_QUEUE_NAME = "agent:learning";

export type LearningJobData = {
  companyId: string;
  department: string;
};

export const learningQueue = new Queue<LearningJobData>(LEARNING_QUEUE_NAME, {
  connection: REDIS_CONNECTION,
});

/**
 * Processes one department learning cycle per job.
 * Jobs are idempotent — re-running after a previous failure is safe because
 * synthesizeDepartmentPlaybook only marks signals as processed on success.
 */
export const learningWorker = new Worker<LearningJobData>(
  LEARNING_QUEUE_NAME,
  async (job: Job<LearningJobData>) => {
    const { companyId, department } = job.data;
    log.info("Running learning cycle", { companyId, department });
    await synthesizeDepartmentPlaybook(companyId, department);
  },
  {
    connection: REDIS_CONNECTION,
    concurrency: 3,
  }
);

/**
 * Registers the daily learning scan job.
 * BullMQ deduplicates by jobId — safe to call on every worker startup.
 *
 * The daily scan queries for all (companyId, department) pairs that have
 * accumulated enough unprocessed signals, then enqueues a learning job per pair.
 */
export async function registerDailyLearningJob(): Promise<void> {
  await learningQueue.add(
    "daily-learning-scan",
    { companyId: "scan", department: "scan" },
    {
      repeat: { every: 24 * 60 * 60 * 1_000 },
      jobId: "daily-learning-scan-repeatable",
    }
  );
}

/**
 * Scans for departments ready to learn and enqueues one job per pair.
 * Called by the daily repeatable job and by the approval route when a
 * threshold is crossed mid-day.
 */
export async function enqueuePendingLearningCycles(): Promise<void> {
  const readyDepts = await findDepartmentsReadyToLearn();

  for (const { companyId, department } of readyDepts) {
    const jobId = `learn:${companyId}:${department}`;
    await learningQueue.add(
      jobId,
      { companyId, department },
      {
        jobId,
        // Deduplicate — if a job for this pair is already queued, skip.
        // The existing job will pick up any new signals too.
      }
    );
  }

  if (readyDepts.length > 0) {
    log.info("Enqueued learning cycles", { count: readyDepts.length });
  }
}

learningWorker.on("completed", (job) => {
  log.info("Learning cycle completed", {
    companyId: job.data.companyId,
    department: job.data.department,
  });
});

learningWorker.on("failed", (job, error) => {
  log.errorWithStack(
    `Learning job failed for ${job?.data.department ?? "unknown"}`,
    error,
    { companyId: job?.data.companyId ?? "unknown" }
  );
});
