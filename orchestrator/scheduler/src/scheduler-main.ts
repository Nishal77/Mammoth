/**
 * Scheduler service entry point.
 *
 * This service has two responsibilities:
 *   1. Register repeatable BullMQ cron jobs for every active company (CEO Brain 6h, Research 12h, Finance 1h)
 *   2. Run the scheduler worker that processes those cron jobs
 *
 * On startup it bootstraps all existing active companies.
 * Every hour it rescans for new companies (just-onboarded) and registers their jobs.
 *
 * The scheduler is intentionally separate from the agent-worker so it can be
 * scaled independently — one scheduler instance is enough for thousands of companies.
 */
import { initSentry, flushSentry } from "@mammoth/observability/sentry";
import { initTracing, shutdownTracing } from "@mammoth/observability/tracing";
import { createLogger } from "@mammoth/observability/logger";

initSentry({
  dsn: process.env["SENTRY_DSN"],
  serviceName: "orchestrator-scheduler",
  environment: process.env["NODE_ENV"] ?? "development",
});

initTracing({
  serviceName: "mammoth-scheduler",
  serviceVersion: process.env["SERVICE_VERSION"] ?? "0.0.1",
  collectorUrl: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
});

const log = createLogger("scheduler-main");

import { db, companies } from "@mammoth/memory-database";
import { isNull } from "drizzle-orm";
import { CompanyScheduler } from "./company-scheduler.ts";
import { createSchedulerWorker } from "./scheduler-worker.ts";
import { CRON_INTERVALS_MS } from "./cron-definitions.ts";

const scheduler = new CompanyScheduler();
const worker = createSchedulerWorker();

/**
 * Registers cron jobs for all currently active companies.
 * BullMQ deduplicates by jobId — safe to call repeatedly.
 */
async function bootstrapActiveCompanies(): Promise<void> {
  const activeCompanies = await db.query.companies.findMany({
    where: isNull(companies.deletedAt),
    columns: { id: true, name: true },
  });

  await Promise.all(
    activeCompanies.map((company) =>
      scheduler.startCompany(company.id).catch((err: unknown) => {
        log.warn("Failed to schedule company", {
          companyId: company.id,
          error: err instanceof Error ? err.message : String(err),
        });
      })
    )
  );

  log.info(`Bootstrapped ${activeCompanies.length} active companies`);
}

worker.on("completed", (job) => {
  log.info("Scheduler job completed", {
    actionType: job.data.jobName,
    companyId: job.data.companyId,
  });
});

worker.on("failed", (job, error) => {
  log.errorWithStack("Scheduler job failed", error, {
    actionType: job?.data.jobName ?? "unknown",
    companyId: job?.data.companyId ?? "unknown",
    attempts: job?.attemptsMade ?? 0,
  });
});

worker.on("error", (error) => {
  log.errorWithStack("Scheduler worker connection error", error);
});

await bootstrapActiveCompanies();

// Rescan every hour for newly-onboarded companies
setInterval(
  () =>
    void bootstrapActiveCompanies().catch((err: unknown) =>
      log.errorWithStack("Company rescan failed", err as Error)
    ),
  CRON_INTERVALS_MS.COMPANY_RESCAN
);

log.info("Orchestrator scheduler running", {
  ceoBrainIntervalHours: CRON_INTERVALS_MS.CEO_BRAIN / 3_600_000,
  researchIntervalHours: CRON_INTERVALS_MS.RESEARCH / 3_600_000,
  financeIntervalHours: CRON_INTERVALS_MS.FINANCE / 3_600_000,
});

const shutdown = async (signal: string): Promise<void> => {
  log.info(`Received ${signal} — shutting down`);
  await Promise.all([worker.close(), scheduler.close(), flushSentry(), shutdownTracing()]);
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
