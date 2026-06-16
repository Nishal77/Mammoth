import { Queue } from "bullmq";
import { db, companies } from "@mammoth/db";
import { eq, isNull } from "drizzle-orm";
import type { AgentJobData } from "@mammoth/agents";
import { QUEUE_NAMES } from "@mammoth/agents";

const CEO_BRAIN_INTERVAL_HOURS = 6;
const CEO_BRAIN_INTERVAL_MS = CEO_BRAIN_INTERVAL_HOURS * 60 * 60 * 1000;

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
 * Schedules a CEO Brain run for every active company.
 * Uses per-company repeatable jobs so each company has its own cadence.
 * Safe to call on startup — BullMQ deduplicates by jobId.
 */
async function scheduleCeoBrainJobs(): Promise<void> {
  const activeCompanies = await db.query.companies.findMany({
    where: isNull(companies.deletedAt),
    columns: { id: true, name: true },
    with: {
      departments: {
        where: (dept, { eq: eqOp }) => eqOp(dept.name, "ceo"),
        columns: { id: true },
        limit: 1,
      },
    },
  });

  for (const company of activeCompanies) {
    const ceoDept = company.departments[0];
    if (!ceoDept) {
      console.warn(`[orchestrator] No CEO department for company ${company.id} — skipping`);
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

    await agentQueue.add(
      `ceo-brain:${company.id}`,
      jobData,
      {
        repeat: { every: CEO_BRAIN_INTERVAL_MS },
        jobId: `ceo-brain-repeatable:${company.id}`,
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 20 },
      }
    );

    console.log(
      `[orchestrator] CEO Brain scheduled for company "${company.name}" every ${CEO_BRAIN_INTERVAL_HOURS}h`
    );
  }
}

async function start(): Promise<void> {
  await scheduleCeoBrainJobs();

  console.log(
    `[orchestrator] CEO Brain scheduler running — interval: every ${CEO_BRAIN_INTERVAL_HOURS}h`
  );

  // Re-check for new companies every hour in case new ones were onboarded
  setInterval(() => void scheduleCeoBrainJobs().catch(console.error), 60 * 60 * 1000);
}

start().catch((error) => {
  console.error("[orchestrator] Failed to start:", error);
  process.exit(1);
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[orchestrator] Received ${signal}, shutting down`);
  await agentQueue.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
