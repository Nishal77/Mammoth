/**
 * All scheduler intervals in one place.
 * Every interval is in milliseconds — BullMQ repeatable jobs use `every`.
 *
 * Rationale for each cadence:
 *   CEO Brain 6h    — strategic enough to react to market signals, not so frequent it burns budget
 *   Research 12h    — competitor landscape rarely changes faster than twice daily
 *   Finance 1h      — MRR and burn rate need to be fresh for CEO Brain decisions
 *   Rescan 1h       — detect new companies that need scheduling after onboarding
 */
export const CRON_INTERVALS_MS = {
  CEO_BRAIN: 6 * 60 * 60 * 1_000,      // 6 hours
  RESEARCH: 12 * 60 * 60 * 1_000,      // 12 hours
  FINANCE: 60 * 60 * 1_000,            // 1 hour
  COMPANY_RESCAN: 60 * 60 * 1_000,     // 1 hour
} as const;

export const SCHEDULER_QUEUE_NAME = "mammoth:scheduler";

export const JOB_NAMES = {
  CEO_BRAIN_CYCLE: "ceo_brain_cycle",
  RESEARCH_CYCLE: "research_cycle",
  FINANCE_CYCLE: "finance_cycle",
} as const;

export type SchedulerJobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export type SchedulerJobData = {
  companyId: string;
  jobName: SchedulerJobName;
};
