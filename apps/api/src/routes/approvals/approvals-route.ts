import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Queue } from "bullmq";
import { db, approvals, trustScores, checkAndPromoteTrustScore } from "@mammoth/memory-database";
import { eq, and, lt, desc } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import { NotFoundError, ValidationError, ForbiddenError } from "@mammoth/shared/errors";
import { successResponse } from "@mammoth/shared/types";

const EXECUTION_QUEUE_NAME = "approval:execute";

const executionQueue = new Queue(EXECUTION_QUEUE_NAME, {
  connection: {
    host: process.env["REDIS_HOST"] ?? "localhost",
    port: Number(process.env["REDIS_PORT"] ?? 6379),
    password: process.env["REDIS_PASSWORD"] ?? undefined,
    maxRetriesPerRequest: null,
  },
});

const ResolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({
    action: z.literal("modify"),
    modifiedContent: z.string().min(1),
    diffSummary: z.string().max(2000).optional(),
  }),
]);

type CompanyParams = { Params: { companyId: string; approvalId?: string } };

async function expireStalePendingApprovals(companyId: string): Promise<void> {
  await db
    .update(approvals)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(approvals.companyId, companyId),
        eq(approvals.status, "pending"),
        lt(approvals.expiresAt, new Date())
      )
    );
}

export async function approvalsRoute(app: FastifyInstance): Promise<void> {
  // GET /companies/:companyId/approvals
  app.get<CompanyParams>(
    "/",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      // Lazily expire stale approvals on read
      await expireStalePendingApprovals(request.company.id);

      const rows = await db.query.approvals.findMany({
        where: eq(approvals.companyId, request.company.id),
        orderBy: [desc(approvals.createdAt)],
        limit: 50,
        with: {
          task: {
            columns: { id: true, taskType: true, departmentId: true },
          },
        },
      });

      return reply.send(successResponse(rows));
    }
  );

  // GET /companies/:companyId/approvals/:approvalId
  app.get<CompanyParams>(
    "/:approvalId",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      await expireStalePendingApprovals(request.company.id);

      const { approvalId } = request.params;
      if (!approvalId) throw new ValidationError("approvalId is required");

      const row = await db.query.approvals.findFirst({
        where: and(
          eq(approvals.id, approvalId),
          eq(approvals.companyId, request.company.id)
        ),
        with: {
          task: true,
        },
      });

      if (!row) throw new NotFoundError("Approval", approvalId);

      return reply.send(successResponse(row));
    }
  );

  // POST /companies/:companyId/approvals/:approvalId/resolve
  app.post<CompanyParams>(
    "/:approvalId/resolve",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { approvalId } = request.params;
      if (!approvalId) throw new ValidationError("approvalId is required");

      const result = ResolveSchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const input = result.data;

      const approval = await db.query.approvals.findFirst({
        where: and(
          eq(approvals.id, approvalId),
          eq(approvals.companyId, request.company.id)
        ),
        columns: {
          id: true,
          status: true,
          expiresAt: true,
          department: true,
          actionType: true,
          ringLevel: true,
        },
      });

      if (!approval) throw new NotFoundError("Approval", approvalId);

      if (approval.status !== "pending") {
        throw new ForbiddenError(
          `Approval is already ${approval.status} — cannot resolve`
        );
      }

      if (approval.expiresAt && approval.expiresAt < new Date()) {
        await db
          .update(approvals)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(approvals.id, approvalId));

        throw new ForbiddenError("Approval window has expired");
      }

      const newStatus =
        input.action === "approve"
          ? "approved"
          : input.action === "reject"
          ? "rejected"
          : "modified";

      const [resolved] = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(approvals)
          .set({
            status: newStatus,
            resolvedBy: request.user.id,
            resolvedAt: new Date(),
            modifiedContent:
              input.action === "modify" ? input.modifiedContent : null,
            diffSummary:
              input.action === "modify" ? (input.diffSummary ?? null) : null,
            updatedAt: new Date(),
          })
          .where(eq(approvals.id, approvalId))
          .returning();

        // Update trust score — any modification resets consecutive unmodified count
        const isModification = input.action === "modify";

        await tx
          .insert(trustScores)
          .values({
            companyId: request.company.id,
            department: approval.department,
            actionType: approval.actionType,
            consecutiveApprovals: 1,
            consecutiveUnmodified: isModification ? 0 : 1,
            ringLevel: approval.ringLevel,
          })
          .onConflictDoUpdate({
            target: [
              trustScores.companyId,
              trustScores.department,
              trustScores.actionType,
            ],
            set: {
              consecutiveApprovals: sql`${trustScores.consecutiveApprovals} + 1`,
              consecutiveUnmodified: isModification
                ? 0
                : sql`${trustScores.consecutiveUnmodified} + 1`,
              updatedAt: new Date(),
            },
          });

        return [updated];
      });

      // Non-blocking — promotion failure must not fail the resolve response
      void checkAndPromoteTrustScore({
        companyId: request.company.id,
        department: approval.department,
        actionType: approval.actionType,
      }).catch((error: unknown) => {
        console.error("[approvals] Trust score promotion check failed:", error);
      });

      // Enqueue execution when approved or content was modified — actions with "approved"
      // or "modified" status both get dispatched. Rejections do not.
      if (newStatus === "approved" || newStatus === "modified") {
        const contentToExecute =
          newStatus === "modified" && input.action === "modify"
            ? input.modifiedContent
            : (resolved?.outputContent ?? "");

        void executionQueue
          .add(
            `execute:${approvalId}`,
            {
              approvalId,
              companyId: request.company.id,
              department: approval.department,
              actionType: approval.actionType,
              outputContent: contentToExecute,
            },
            {
              jobId: `execute:${approvalId}`,
              attempts: 3,
              backoff: { type: "exponential", delay: 5_000 },
            }
          )
          .catch((error: unknown) => {
            console.error("[approvals] Failed to enqueue execution job:", error);
          });
      }

      return reply.send(successResponse(resolved));
    }
  );
}

// drizzle sql helper
import { sql } from "drizzle-orm";
