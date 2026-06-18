import { createLogger } from "@mammoth/observability/logger";
import { Queue } from "bullmq";
import { db, companies } from "@mammoth/memory-database";
import { isNull } from "drizzle-orm";
import type { AgentJobData } from "@mammoth/agent-base";
import { QUEUE_NAMES } from "@mammoth/agent-base";

const log = createLogger("orchestrator");

const CEO_BRAIN_INTERVAL_HOURS = 6;
const CEO_BRAIN_INTERVAL_MS = CEO_BRAIN_INTERVAL_HOURS * 60 * 60 * 1000;

// Re-scan for new companies every hour so newly-onboarded ones get scheduled.
const COMPANY_RESCAN_INTERVAL_MS = 60 * 60 * 1000;

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

const agentQueue = new Queue<AgentJobData>(QUEUE_NAMES.AGENT_TASKS, {
  connection: REDIS_CONNECTION,
});

/**
 * Registers a repeatable CEO Brain job for every active company.
 * BullMQ deduplicates by jobId so calling this multiple times is safe —
 * an existing job for a company will not be double-scheduled.
 */
async function scheduleCeoBrainJobs(): Promise<void> {
  const activeCompanies = await db.query.companies.findMany({
    where: isNull(companies.deletedAt),
    columns: { id: true, name: true },
    with: {
      departments: {
        where: (dept, { eq }) => eq(dept.name, "ceo"),
        columns: { id: true },
        limit: 1,
      },
    },
  });

  for (const company of activeCompanies) {
    const ceoDept = company.departments[0];

    if (!ceoDept) {
      log.warn("No CEO department found — skipping", { companyId: company.id });
      continue;
    }

    const jobData: AgentJobData = {
      companyId: company.id,
      departmentId: ceoDept.id,
      taskId: `ceo-cycle-${company.id}`,
      agentRunId: `ceo-run-${company.id}`,
      taskType: "goal_review_and_decomposition",
      parameters: {},
    };

    await agentQueue.add(`ceo-brain:${company.id}`, jobData, {
      repeat: { every: CEO_BRAIN_INTERVAL_MS },
      jobId: `ceo-brain-repeatable:${company.id}`,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    });

    log.info("CEO Brain scheduled", {
      companyId: company.id,
      actionType: "ceo_brain_schedule",
    });
  }
}

async function start(): Promise<void> {
  await scheduleCeoBrainJobs();

  log.info(`CEO Brain scheduler active — interval: every ${CEO_BRAIN_INTERVAL_HOURS}h`);

  setInterval(
    () =>
      void scheduleCeoBrainJobs().catch((error: unknown) =>
        log.errorWithStack("Failed to rescan companies", error as Error)
      ),
    COMPANY_RESCAN_INTERVAL_MS
  );
}

start().catch((error: unknown) => {
  log.errorWithStack("Orchestrator failed to start", error as Error);
  process.exit(1);
});

const shutdown = async (signal: string): Promise<void> => {
  log.info(`Received ${signal}, shutting down`);
  await agentQueue.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
