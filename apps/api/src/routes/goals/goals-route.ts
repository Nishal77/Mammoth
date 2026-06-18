import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, companyGoals } from "@mammoth/memory-database";
import { eq, and, isNull, desc } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import { NotFoundError, ValidationError } from "@mammoth/shared/errors";
import { successResponse } from "@mammoth/shared/types";

const CreateGoalSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.enum(["revenue", "users", "other"]),
  targetValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
  unit: z.string().max(50),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const UpdateGoalSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  targetValue: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  currentValue: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z
    .enum(["active", "paused", "completed", "abandoned"])
    .optional(),
});

type GoalParams = { Params: { companyId: string; goalId?: string } };

export async function goalsRoute(app: FastifyInstance): Promise<void> {
  // GET /companies/:companyId/goals
  app.get(
    "/",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request: FastifyRequest<GoalParams>, reply) => {
      const rows = await db.query.companyGoals.findMany({
        where: and(
          eq(companyGoals.companyId, request.company.id),
          isNull(companyGoals.deletedAt)
        ),
        orderBy: [desc(companyGoals.createdAt)],
      });

      return reply.send(successResponse(rows));
    }
  );

  // POST /companies/:companyId/goals
  app.post(
    "/",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request: FastifyRequest<GoalParams>, reply) => {
      const result = CreateGoalSchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const input = result.data;

      const [goal] = await db
        .insert(companyGoals)
        .values({
          companyId: request.company.id,
          title: input.title,
          type: input.type,
          targetValue: input.targetValue,
          currentValue: "0",
          unit: input.unit,
          deadline: input.deadline,
          status: "active",
        })
        .returning();

      return reply.status(201).send(successResponse(goal));
    }
  );

  // PATCH /companies/:companyId/goals/:goalId
  app.patch(
    "/:goalId",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request: FastifyRequest<GoalParams>, reply) => {
      const { goalId } = request.params;
      if (!goalId) throw new ValidationError("goalId is required");

      const result = UpdateGoalSchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const [updated] = await db
        .update(companyGoals)
        .set({ ...result.data, updatedAt: new Date() })
        .where(
          and(
            eq(companyGoals.id, goalId),
            eq(companyGoals.companyId, request.company.id),
            isNull(companyGoals.deletedAt)
          )
        )
        .returning();

      if (!updated) throw new NotFoundError("Goal", goalId);

      return reply.send(successResponse(updated));
    }
  );
}
