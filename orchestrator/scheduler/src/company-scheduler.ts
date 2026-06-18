import { Queue } from "bullmq";
import { createLogger } from "@mammoth/observability/logger";
import {
  CRON_INTERVALS_MS,
  SCHEDULER_QUEUE_NAME,
  JOB_NAMES,
} from "./cron-definitions.ts";
import type { SchedulerJobData } from "./cron-definitions.ts";

const log = createLogger("company-scheduler");

function buildRedisConnection() {
  return {
    host: process.env["REDIS_HOST"] ?? "localhost",
    port: Number(process.env["REDIS_PORT"] ?? 6379),
    password: process.env["REDIS_PASSWORD"] ?? undefined,
    maxRetriesPerRequest: null,
  } as const;
}

/**
 * Manages BullMQ repeatable jobs for one company.
 *
 * Each active company gets three crons:
 *   - CEO Brain (every 6h) — planning + department dispatch
 *   - Research (every 12h) — competitor intel + market scan
 *   - Finance (every 1h) — Stripe metrics pull + metricsDaily update
 *
 * BullMQ deduplicates by jobId — calling startCompany() multiple times is safe.
 * Jobs are named "{type}:{companyId}" so they can be removed individually.
 */
export class CompanyScheduler {
  private readonly queue: Queue<SchedulerJobData>;

  constructor() {
    this.queue = new Queue<SchedulerJobData>(SCHEDULER_QUEUE_NAME, {
      connection: buildRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    });
  }

  /**
   * Registers all three repeatable jobs for a company.
   * Safe to call on already-scheduled companies — BullMQ deduplicates by jobId.
   */
  async startCompany(companyId: string): Promise<void> {
    await Promise.all([
      this.registerJob(companyId, JOB_NAMES.CEO_BRAIN_CYCLE, CRON_INTERVALS_MS.CEO_BRAIN),
      this.registerJob(companyId, JOB_NAMES.RESEARCH_CYCLE, CRON_INTERVALS_MS.RESEARCH),
      this.registerJob(companyId, JOB_NAMES.FINANCE_CYCLE, CRON_INTERVALS_MS.FINANCE),
    ]);

    log.info("Company scheduling started", { companyId });
  }

  /**
   * Removes all repeatable jobs for a company.
   * Called when a company is paused, deleted, or reaches plan limit.
   */
  async stopCompany(companyId: string): Promise<void> {
    await Promise.all([
      this.removeJob(companyId, JOB_NAMES.CEO_BRAIN_CYCLE),
      this.removeJob(companyId, JOB_NAMES.RESEARCH_CYCLE),
      this.removeJob(companyId, JOB_NAMES.FINANCE_CYCLE),
    ]);

    log.info("Company scheduling stopped", { companyId });
  }

  /**
   * Fires an immediate CEO Brain cycle for a company, outside the normal schedule.
   * Used when a founder updates their goal and wants instant re-planning.
   */
  async triggerImmediateCycle(companyId: string): Promise<string> {
    const job = await this.queue.add(
      JOB_NAMES.CEO_BRAIN_CYCLE,
      { companyId, jobName: JOB_NAMES.CEO_BRAIN_CYCLE },
      {
        jobId: `immediate:${JOB_NAMES.CEO_BRAIN_CYCLE}:${companyId}:${Date.now()}`,
        priority: 1,
      }
    );

    log.info("Immediate cycle triggered", { companyId, jobId: job.id });
    return job.id ?? "";
  }

  /**
   * Returns all active repeatable jobs for a company.
   * Used for dashboard display and health checks.
   */
  async getCompanyJobs(companyId: string): Promise<{ name: string; nextRun: number }[]> {
    const repeatableJobs = await this.queue.getRepeatableJobs();
    return repeatableJobs
      .filter((job) => job.id?.includes(companyId) ?? false)
      .map((job) => ({
        name: job.name,
        nextRun: job.next ?? 0,
      }));
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  private async registerJob(
    companyId: string,
    jobName: SchedulerJobName,
    intervalMs: number
  ): Promise<void> {
    const jobData: SchedulerJobData = { companyId, jobName };

    await this.queue.add(jobName, jobData, {
      repeat: { every: intervalMs },
      jobId: `repeatable:${jobName}:${companyId}`,
    });
  }

  private async removeJob(companyId: string, jobName: SchedulerJobName): Promise<void> {
    const jobId = `repeatable:${jobName}:${companyId}`;

    const repeatableJobs = await this.queue.getRepeatableJobs();
    const matching = repeatableJobs.filter((j) => j.id === jobId || j.key.includes(companyId));

    await Promise.all(
      matching.map((j) => this.queue.removeRepeatableByKey(j.key))
    );
  }
}

// Narrow type for the private method's parameter
type SchedulerJobName = typeof JOB_NAMES[keyof typeof JOB_NAMES];
