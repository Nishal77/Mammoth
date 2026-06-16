import type { FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../lib/auth.ts";
import { UnauthorizedError } from "@mammoth/shared/errors";

/**
 * Fastify preHandler that validates the Better Auth session.
 * Attaches the session user to request.user for downstream handlers.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const session = await auth.api.getSession({
    headers: request.headers as Headers,
  });

  if (!session?.user) {
    const err = new UnauthorizedError();
    reply.status(err.statusCode).send({
      data: null,
      error: { message: err.message, code: err.code },
    });
    return;
  }

  request.user = session.user;
}

// Augment Fastify's request type
declare module "fastify" {
  interface FastifyRequest {
    user: { id: string; email: string; name?: string | null };
  }
}
