import type { FastifyInstance, FastifyRequest } from "fastify";
import { db, metricsDaily } from "@mammoth/memory-database";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import { ValidationError } from "@mammoth/shared/errors";
import { successResponse } from "@mammoth/shared/types";

type MetricsParams = {
  Params: { companyId: string };
  Querystring: { from?: string; to?: string };
};

export async function metricsRoute(app: FastifyInstance): Promise<void> {
  // GET /companies/:companyId/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
  app.get(
    "/",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request: FastifyRequest<MetricsParams>, reply) => {
      const { from, to } = request.query;

      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if ((from && !datePattern.test(from)) || (to && !datePattern.test(to))) {
        throw new ValidationError("Date format must be YYYY-MM-DD");
      }

      const conditions = [eq(metricsDaily.companyId, request.company.id)];
      if (from) conditions.push(gte(metricsDaily.date, from));
      if (to) conditions.push(lte(metricsDaily.date, to));

      const rows = await db.query.metricsDaily.findMany({
        where: and(...conditions),
        orderBy: [desc(metricsDaily.date)],
        limit: 90,
      });

      return reply.send(successResponse(rows));
    }
  );

  // GET /companies/:companyId/metrics/summary — latest row + 30d aggregates
  app.get(
    "/summary",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request: FastifyRequest<MetricsParams>, reply) => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const fromDate = thirtyDaysAgo.toISOString().slice(0, 10);

      const [latest, aggregates] = await Promise.all([
        db.query.metricsDaily.findFirst({
          where: eq(metricsDaily.companyId, request.company.id),
          orderBy: [desc(metricsDaily.date)],
        }),
        db
          .select({
            totalAiCostUsd: sql<string>`sum(${metricsDaily.aiCostUsd})`,
            totalTasksRun: sql<number>`sum(${metricsDaily.tasksRun})`,
            totalEmailsSent: sql<number>`sum(${metricsDaily.emailsSent})`,
            totalContentPublished: sql<number>`sum(${metricsDaily.contentPublished})`,
            avgEmailOpenRate: sql<string>`avg(${metricsDaily.emailOpenRate})`,
          })
          .from(metricsDaily)
          .where(
            and(
              eq(metricsDaily.companyId, request.company.id),
              gte(metricsDaily.date, fromDate)
            )
          ),
      ]);

      return reply.send(
        successResponse({
          latest: latest ?? null,
          last30Days: aggregates[0] ?? null,
        })
      );
    }
  );
}
