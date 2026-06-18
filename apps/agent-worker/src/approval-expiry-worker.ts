import { Queue, Worker, type Job } from "bullmq";
import { db, approvals, trustScores, publishNotification, checkAndPromoteTrustScore } from "@mammoth/db";
import { eq, and, lt, sql } from "drizzle-orm";
import { executionQueue } from "./action-execution-worker.ts";

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

const EXPIRY_QUEUE_NAME = "approval:expiry-check";
const VETO_ALERT_THRESHOLD_MS = 30 * 60 * 1000; // alert 30 min before expiry

export const expiryCheckQueue = new Queue(EXPIRY_QUEUE_NAME, {
  connection: REDIS_CONNECTION,
});

/**
 * Registers the repeatable expiry-check job.
 * BullMQ deduplicates by jobId — safe to call on every startup.
 */
export async function registerExpiryCheckJob(): Promise<void> {
  await expiryCheckQueue.add(
    "expiry-check",
    {},
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "expiry-check-repeatable",
    }
  );
}

/**
 * Processes Ring 2 approvals that have passed their veto window.
 * Auto-approves them and increments trust scores.
 * Also queues 30-minute veto alerts for approvals approaching expiry.
 */
export const expiryWorker = new Worker(
  EXPIRY_QUEUE_NAME,
  async (_job: Job) => {
    await autoApproveExpired();
    await sendApproachingVetoAlerts();
  },
  { connection: REDIS_CONNECTION }
);

async function autoApproveExpired(): Promise<void> {
  const expiredApprovals = await db.query.approvals.findMany({
    where: and(
      eq(approvals.status, "pending"),
      eq(approvals.ringLevel, 2),
      lt(approvals.expiresAt, new Date())
    ),
    columns: {
      id: true,
      companyId: true,
      department: true,
      actionType: true,
      outputContent: true,
    },
  });

  for (const approval of expiredApprovals) {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(approvals)
        .set({ status: "approved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(approvals.id, approval.id),
            eq(approvals.status, "pending") // guard against race
          )
        )
        .returning({ id: approvals.id });

      if (!updated.length) return; // another worker already processed it

      await tx
        .insert(trustScores)
        .values({
          companyId: approval.companyId,
          department: approval.department,
          actionType: approval.actionType,
          ringLevel: 2,
          consecutiveApprovals: 1,
          consecutiveUnmodified: 1,
          totalApprovals: 1,
          totalModifications: 0,
        })
        .onConflictDoUpdate({
          target: [
            trustScores.companyId,
            trustScores.department,
            trustScores.actionType,
          ],
          set: {
            consecutiveApprovals: sql`${trustScores.consecutiveApprovals} + 1`,
            consecutiveUnmodified: sql`${trustScores.consecutiveUnmodified} + 1`,
            totalApprovals: sql`${trustScores.totalApprovals} + 1`,
            updatedAt: new Date(),
          },
        });
    });

    // Enqueue execution after auto-approval — Ring 2 veto window passed
    void executionQueue
      .add(
        `execute:${approval.id}`,
        {
          approvalId: approval.id,
          companyId: approval.companyId,
          department: approval.department,
          actionType: approval.actionType,
          outputContent: approval.outputContent,
        },
        { jobId: `execute:${approval.id}`, attempts: 3, backoff: { type: "exponential", delay: 5_000 } }
      )
      .catch((error: unknown) => {
        console.error("[expiry-worker] Failed to enqueue execution:", error);
      });

    // Non-blocking — promotion check must not fail the expiry cycle
    void checkAndPromoteTrustScore({
      companyId: approval.companyId,
      department: approval.department,
      actionType: approval.actionType,
    }).catch((error: unknown) => {
      console.error("[expiry-worker] Trust score promotion check failed:", error);
    });
  }
}

async function sendApproachingVetoAlerts(): Promise<void> {
  const windowEnd = new Date(Date.now() + VETO_ALERT_THRESHOLD_MS);
  const windowStart = new Date(Date.now() + VETO_ALERT_THRESHOLD_MS - 5 * 60 * 1000);

  const approaching = await db.query.approvals.findMany({
    where: and(
      eq(approvals.status, "pending"),
      eq(approvals.ringLevel, 2),
      sql`${approvals.expiresAt} >= ${windowStart} AND ${approvals.expiresAt} <= ${windowEnd}`
    ),
    columns: {
      id: true,
      expiresAt: true,
    },
    with: {
      company: { columns: { ownerId: true } },
    },
  });

  for (const approval of approaching) {
    const minutesLeft = Math.round(
      ((approval.expiresAt?.getTime() ?? 0) - Date.now()) / 60_000
    );

    await publishNotification({
      type: "veto_alert",
      userId: (approval as typeof approval & { company: { ownerId: string } }).company.ownerId,
      approvalId: approval.id,
      minutesLeft,
    });
  }
}

expiryWorker.on("failed", (job, error) => {
  console.error(`[expiry-worker] Job ${job?.id ?? "unknown"} failed:`, error.message);
});

expiryWorker.on("error", (error) => {
  console.error("[expiry-worker] Connection error:", error);
});
