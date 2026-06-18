import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, departments, departmentTasks } from "@mammoth/memory-database";
import { eq, and, desc } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import { NotFoundError, ValidationError } from "@mammoth/shared/errors";
import { successResponse } from "@mammoth/shared/types";

const VALID_DEPT_NAMES = [
  "ceo",
  "marketing",
  "sales",
  "engineering",
  "support",
  "finance",
  "research",
  "hr",
  "content",
] as const;

type DeptName = typeof VALID_DEPT_NAMES[number];

const UpdateDepartmentSchema = z.object({
  playbook: z.string().max(50000).optional(),
  ringDefaults: z
    .object({
      defaultRing: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .optional(),
  config: z.record(z.unknown()).optional(),
});

type DeptParams = {
  Params: { companyId: string; deptName?: string };
  Querystring: { limit?: string; offset?: string };
};

export async function departmentsRoute(app: FastifyInstance): Promise<void> {
  // GET /companies/:companyId/departments
  app.get<DeptParams>(
    "/",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const rows = await db.query.departments.findMany({
        where: eq(departments.companyId, request.company.id),
        orderBy: (d, { asc }) => [asc(d.name)],
      });

      return reply.send(successResponse(rows));
    }
  );

  // PATCH /companies/:companyId/departments/:deptName
  app.patch<DeptParams>(
    "/:deptName",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { deptName } = request.params;

      if (!deptName || !VALID_DEPT_NAMES.includes(deptName as DeptName)) {
        throw new ValidationError(
          `Invalid department. Must be one of: ${VALID_DEPT_NAMES.join(", ")}`
        );
      }

      const result = UpdateDepartmentSchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      const { playbook, ringDefaults, config } = result.data;

      let newPlaybookVersion: number | undefined;
      if (playbook !== undefined) {
        const current = await db.query.departments.findFirst({
          where: and(
            eq(departments.companyId, request.company.id),
            eq(departments.name, deptName as DeptName)
          ),
          columns: { playbookVersion: true },
        });
        newPlaybookVersion = (current?.playbookVersion ?? 0) + 1;
      }

      const [updated] = await db
        .update(departments)
        .set({
          ...(playbook !== undefined && { playbook }),
          ...(newPlaybookVersion !== undefined && {
            playbookVersion: newPlaybookVersion,
          }),
          ...(ringDefaults !== undefined && { ringDefaults }),
          ...(config !== undefined && { config }),
        })
        .where(
          and(
            eq(departments.companyId, request.company.id),
            eq(departments.name, deptName as DeptName)
          )
        )
        .returning();

      if (!updated) throw new NotFoundError("Department", deptName);

      return reply.send(successResponse(updated));
    }
  );

  // GET /companies/:companyId/departments/:deptName/tasks
  app.get<DeptParams>(
    "/:deptName/tasks",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { deptName } = request.params;
      if (!deptName) throw new ValidationError("deptName is required");

      const limit = Math.min(Number(request.query.limit ?? 20), 100);
      const offset = Number(request.query.offset ?? 0);

      const dept = await db.query.departments.findFirst({
        where: and(
          eq(departments.companyId, request.company.id),
          eq(departments.name, deptName as DeptName)
        ),
        columns: { id: true },
      });

      if (!dept) throw new NotFoundError("Department", deptName);

      const rows = await db.query.departmentTasks.findMany({
        where: eq(departmentTasks.departmentId, dept.id),
        orderBy: [desc(departmentTasks.createdAt)],
        limit,
        offset,
        with: {
          runs: { orderBy: (r, { asc }) => [asc(r.runNumber)] },
        },
      });

      return reply.send(successResponse(rows));
    }
  );

  // GET /companies/:companyId/departments/:deptName/outputs
  app.get<DeptParams>(
    "/:deptName/outputs",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { deptName } = request.params;
      if (!deptName) throw new ValidationError("deptName is required");

      const limit = Math.min(Number(request.query.limit ?? 10), 50);

      const dept = await db.query.departments.findFirst({
        where: and(
          eq(departments.companyId, request.company.id),
          eq(departments.name, deptName as DeptName)
        ),
        columns: { id: true },
      });

      if (!dept) throw new NotFoundError("Department", deptName);

      const rows = await db.query.departmentTasks.findMany({
        where: and(
          eq(departmentTasks.departmentId, dept.id),
          eq(departmentTasks.status, "completed")
        ),
        columns: {
          id: true,
          taskType: true,
          outputContent: true,
          completedAt: true,
        },
        orderBy: [desc(departmentTasks.completedAt)],
        limit,
      });

      return reply.send(successResponse(rows));
    }
  );
}
