import type { FastifyInstance } from "fastify";
import { db, companies, departments, companyGoals, briefings } from "@mammoth/db";
import { eq, isNull, and, desc } from "drizzle-orm";
import { DEPARTMENT_NAMES } from "@mammoth/db/schema";
import { authenticate } from "../../middleware/authenticate.ts";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import { generateCompanySlug } from "@mammoth/shared/utils";
import {
  NotFoundError,
  ConflictError,
  OptimisticLockError,
  ValidationError,
} from "@mammoth/shared/errors";
import { CreateCompanySchema, UpdateCompanySchema } from "./company-schemas.ts";
import { successResponse } from "@mammoth/shared/types";

export async function companiesRoute(app: FastifyInstance): Promise<void> {
  // GET /companies
  app.get(
    "/",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const rows = await db.query.companies.findMany({
        where: and(
          eq(companies.ownerId, request.user.id),
          isNull(companies.deletedAt)
        ),
        columns: {
          id: true,
          name: true,
          slug: true,
          tagline: true,
          industry: true,
          stage: true,
          logoUrl: true,
          createdAt: true,
        },
        orderBy: (c, { desc }) => [desc(c.createdAt)],
      });

      return reply.send(successResponse(rows));
    }
  );

  // POST /companies
  app.post(
    "/",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const result = CreateCompanySchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const input = result.data;
      const slug = generateCompanySlug(input.name);

      const existing = await db.query.companies.findFirst({
        where: eq(companies.slug, slug),
        columns: { id: true },
      });
      if (existing) throw new ConflictError("company slug", slug);

      const company = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(companies)
          .values({
            ownerId: request.user.id,
            name: input.name,
            slug,
            tagline: input.tagline,
            description: input.description,
            industry: input.industry,
            stage: input.stage,
            website: input.website || null,
            brandVoice: input.brandVoice,
            version: 1,
          })
          .returning();

        if (!created) throw new Error("Insert returned no row");

        await tx.insert(departments).values(
          DEPARTMENT_NAMES.map((name) => ({
            companyId: created.id,
            name,
            status: "idle" as const,
            ringDefaults: { defaultRing: 2 as const },
            playbookVersion: 1,
          }))
        );

        return created;
      });

      return reply.status(201).send(successResponse(company));
    }
  );

  // GET /companies/:companyId
  app.get(
    "/:companyId",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const row = await db.query.companies.findFirst({
        where: and(
          eq(companies.id, request.company.id),
          isNull(companies.deletedAt)
        ),
      });

      if (!row) throw new NotFoundError("Company", request.company.id);

      return reply.send(successResponse(row));
    }
  );

  // PATCH /companies/:companyId
  app.patch(
    "/:companyId",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const result = UpdateCompanySchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const { version, ...fields } = result.data;

      const [updated] = await db
        .update(companies)
        .set({
          ...fields,
          website: fields.website || null,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companies.id, request.company.id),
            eq(companies.version, version),
            isNull(companies.deletedAt)
          )
        )
        .returning();

      if (!updated) throw new OptimisticLockError("Company");

      return reply.send(successResponse(updated));
    }
  );

  // DELETE /companies/:companyId — soft delete
  app.delete(
    "/:companyId",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      await db
        .update(companies)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(companies.id, request.company.id),
            isNull(companies.deletedAt)
          )
        );

      return reply.status(204).send();
    }
  );

  // GET /companies/:companyId/briefing/today
  app.get(
    "/:companyId/briefing/today",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const today = new Date().toISOString().slice(0, 10);

      const row = await db.query.briefings.findFirst({
        where: and(
          eq(briefings.companyId, request.company.id),
          eq(briefings.briefingDate, today)
        ),
      });

      if (!row) throw new NotFoundError("Briefing", today);

      return reply.send(successResponse(row));
    }
  );
}
