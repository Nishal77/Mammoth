import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, companyMemory } from "@mammoth/memory-database";
import { eq, and, ilike, desc } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from "@mammoth/shared/errors";
import { successResponse } from "@mammoth/shared/types";

const MEMORY_TYPES = [
  "identity",
  "brand_voice",
  "icp",
  "competitor",
  "customer_insight",
  "market_intel",
  "product_lesson",
  "playbook_refinement",
] as const;

const CreateMemorySchema = z.object({
  memoryType: z.enum(MEMORY_TYPES),
  key: z.string().min(1).max(500),
  value: z.string().min(1),
  source: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

const UpdateMemorySchema = z.object({
  value: z.string().min(1).optional(),
  source: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

type CompanyParams = { Params: { companyId: string; memoryId?: string } };
type CompanyWithTypeQuery = CompanyParams & { Querystring: { type?: string } };
type CompanyWithSearchQuery = CompanyParams & { Querystring: { q?: string } };

export async function memoryRoute(app: FastifyInstance): Promise<void> {
  // GET /companies/:companyId/memory
  app.get<CompanyWithTypeQuery>(
    "/",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { type } = request.query;

      const where = type
        ? and(
            eq(companyMemory.companyId, request.company.id),
            eq(companyMemory.memoryType, type as typeof MEMORY_TYPES[number])
          )
        : eq(companyMemory.companyId, request.company.id);

      const rows = await db.query.companyMemory.findMany({
        where,
        orderBy: [desc(companyMemory.updatedAt)],
      });

      return reply.send(successResponse(rows));
    }
  );

  // POST /companies/:companyId/memory
  app.post<CompanyParams>(
    "/",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const result = CreateMemorySchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const input = result.data;

      const existing = await db.query.companyMemory.findFirst({
        where: and(
          eq(companyMemory.companyId, request.company.id),
          eq(companyMemory.memoryType, input.memoryType),
          eq(companyMemory.key, input.key)
        ),
        columns: { id: true },
      });

      if (existing) {
        throw new ConflictError(
          `memory (${input.memoryType}, ${input.key})`,
          existing.id
        );
      }

      const [created] = await db
        .insert(companyMemory)
        .values({
          companyId: request.company.id,
          memoryType: input.memoryType,
          key: input.key,
          value: input.value,
          source: input.source,
          confidence: input.confidence?.toString(),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning();

      return reply.status(201).send(successResponse(created));
    }
  );

  // PATCH /companies/:companyId/memory/:memoryId
  app.patch<CompanyParams>(
    "/:memoryId",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { memoryId } = request.params;
      if (!memoryId) throw new ValidationError("memoryId is required");

      const result = UpdateMemorySchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const { confidence, expiresAt, ...rest } = result.data;

      const [updated] = await db
        .update(companyMemory)
        .set({
          ...rest,
          confidence: confidence !== undefined ? confidence.toString() : undefined,
          expiresAt: expiresAt !== undefined
            ? expiresAt === null ? null : new Date(expiresAt)
            : undefined,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companyMemory.id, memoryId),
            eq(companyMemory.companyId, request.company.id)
          )
        )
        .returning();

      if (!updated) throw new NotFoundError("Memory", memoryId);

      return reply.send(successResponse(updated));
    }
  );

  // DELETE /companies/:companyId/memory/:memoryId
  app.delete<CompanyParams>(
    "/:memoryId",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { memoryId } = request.params;
      if (!memoryId) throw new ValidationError("memoryId is required");

      const deleted = await db
        .delete(companyMemory)
        .where(
          and(
            eq(companyMemory.id, memoryId),
            eq(companyMemory.companyId, request.company.id)
          )
        )
        .returning({ id: companyMemory.id });

      if (!deleted.length) throw new NotFoundError("Memory", memoryId);

      return reply.status(204).send();
    }
  );

  // GET /companies/:companyId/memory/search?q=...
  app.get<CompanyWithSearchQuery>(
    "/search",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { q } = request.query;
      if (!q || q.trim().length < 2) {
        throw new ValidationError("Search query must be at least 2 characters");
      }

      const rows = await db.query.companyMemory.findMany({
        where: and(
          eq(companyMemory.companyId, request.company.id),
          ilike(companyMemory.value, `%${q}%`)
        ),
        orderBy: [desc(companyMemory.updatedAt)],
        limit: 20,
      });

      return reply.send(successResponse(rows));
    }
  );
}
