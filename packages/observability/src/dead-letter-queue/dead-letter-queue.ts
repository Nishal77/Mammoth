import { Queue, type Job, type ConnectionOptions } from "bullmq";

/**
 * Dead Letter Queue (DLQ) for failed BullMQ agent jobs.
 *
 * WHY: BullMQ moves jobs to its internal "failed" set after all retries
 * are exhausted. That set is hard to inspect, replay, or alert on.
 * The DLQ copies failed jobs to a dedicated queue where operators can:
 *   - See them in a dashboard (Bull Board, etc.)
 *   - Replay them after fixing the root cause
 *   - Alert on DLQ depth (> 0 = something is wrong)
 */

export type DlqJobData = {
  /** Original job ID from the source queue. */
  originalJobId: string;
  /** Name of the queue the job came from. */
  sourceQueue: string;
  /** Original job data so we can replay it. */
  originalData: unknown;
  /** The error message that caused the failure. */
  errorMessage: string;
  /** Full stack trace for debugging. */
  errorStack: string | undefined;
  /** ISO timestamp when the job failed. */
  failedAt: string;
  /** How many times BullMQ retried before giving up. */
  attemptsMade: number;
};

export const DLQ_QUEUE_NAME = "dead-letter-queue";

/**
 * Publishes a failed job to the DLQ.
 * Call this in your worker's `failed` event handler.
 *
 * @param redisConnection - The same Redis connection options used by BullMQ
 * @param sourceQueue     - Name of the queue the job came from
 * @param job             - The failed BullMQ job
 * @param error           - The error that caused the failure
 */
export async function publishToDlq(
  redisConnection: ConnectionOptions,
  sourceQueue: string,
  job: Job,
  error: Error
): Promise<void> {
  const dlqQueue = new Queue<DlqJobData>(DLQ_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      // DLQ jobs never retry — they sit here for operator review.
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    },
  });

  const dlqData: DlqJobData = {
    originalJobId: job.id ?? "unknown",
    sourceQueue,
    originalData: job.data,
    errorMessage: error.message,
    errorStack: error.stack,
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
  };

  await dlqQueue.add(`failed:${job.id ?? "unknown"}`, dlqData);
  await dlqQueue.close();
}

/**
 * Returns all jobs currently in the DLQ.
 * Use this for a monitoring endpoint or admin dashboard.
 *
 * @param redisConnection - The same Redis connection options used by BullMQ
 */
export async function getDlqJobs(redisConnection: ConnectionOptions): Promise<DlqJobData[]> {
  const dlqQueue = new Queue<DlqJobData>(DLQ_QUEUE_NAME, {
    connection: redisConnection,
  });

  const jobs = await dlqQueue.getJobs(["wait", "delayed", "failed"]);
  await dlqQueue.close();

  return jobs.map((job) => job.data);
}

/**
 * Replays a DLQ job by re-adding its original data to the source queue.
 * Use this after fixing the root cause of a failure.
 *
 * @param redisConnection  - The same Redis connection options used by BullMQ
 * @param originalJobId    - The originalJobId from the DlqJobData
 */
export async function replayDlqJob(
  redisConnection: ConnectionOptions,
  originalJobId: string
): Promise<boolean> {
  const dlqQueue = new Queue<DlqJobData>(DLQ_QUEUE_NAME, {
    connection: redisConnection,
  });

  const jobs = await dlqQueue.getJobs(["wait", "delayed", "failed"]);
  const target = jobs.find((job) => job.data.originalJobId === originalJobId);

  if (!target) {
    await dlqQueue.close();
    return false;
  }

  // Re-add to the original source queue with fresh options.
  const sourceQueue = new Queue(target.data.sourceQueue, {
    connection: redisConnection,
  });

  await sourceQueue.add(
    `replay:${originalJobId}`,
    target.data.originalData as Record<string, unknown>,
    { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
  );

  // Remove from DLQ so it is not replayed twice.
  await target.remove();

  await Promise.all([dlqQueue.close(), sourceQueue.close()]);
  return true;
}

/**
 * Returns the number of jobs currently waiting in the DLQ.
 * Use this for a health/metrics endpoint. DLQ depth > 0 should alert.
 *
 * @param redisConnection - The same Redis connection options used by BullMQ
 */
export async function getDlqDepth(redisConnection: ConnectionOptions): Promise<number> {
  const dlqQueue = new Queue<DlqJobData>(DLQ_QUEUE_NAME, {
    connection: redisConnection,
  });

  const counts = await dlqQueue.getJobCounts("wait", "delayed", "failed");
  await dlqQueue.close();

  return (counts.wait ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0);
}
