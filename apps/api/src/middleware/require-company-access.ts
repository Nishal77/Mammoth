import type { FastifyReply, FastifyRequest } from "fastify";
import { db, companies } from "@mammoth/memory-database";
import { eq, and, isNull } from "drizzle-orm";
import { ForbiddenError, NotFoundError } from "@mammoth/shared/errors";

/**
 * Verifies the authenticated user owns the :companyId route param.
 * Must run after `authenticate`. Attaches company to request.company.
 */
export async function requireCompanyAccess(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params as { companyId: string };

  const company = await db.query.companies.findFirst({
    where: and(
      eq(companies.id, companyId),
      isNull(companies.deletedAt)
    ),
    columns: {
      id: true,
      ownerId: true,
      name: true,
      slug: true,
      version: true,
    },
  });

  if (!company) {
    const err = new NotFoundError("Company", companyId);
    reply.status(err.statusCode).send({
      data: null,
      error: { message: err.message, code: err.code },
    });
    return;
  }

  if (company.ownerId !== request.user.id) {
    const err = new ForbiddenError();
    reply.status(err.statusCode).send({
      data: null,
      error: { message: err.message, code: err.code },
    });
    return;
  }

  request.company = company;
}

declare module "fastify" {
  interface FastifyRequest {
    company: {
      id: string;
      ownerId: string;
      name: string;
      slug: string;
      version: number;
    };
  }
}
