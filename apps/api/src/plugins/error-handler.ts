import type { FastifyError, FastifyInstance } from "fastify";
import { AppError } from "@mammoth/shared/errors";

/**
 * Centralised error handler — maps AppError subclasses to HTTP responses.
 * All responses use the standard { data, error } envelope.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        data: null,
        error: { message: error.message, code: error.code },
      });
      return;
    }

    // Fastify validation errors
    if (error.statusCode === 400) {
      reply.status(400).send({
        data: null,
        error: { message: error.message, code: "VALIDATION_ERROR" },
      });
      return;
    }

    // Unhandled errors — log and return generic 500
    app.log.error({ err: error }, "Unhandled error");
    reply.status(500).send({
      data: null,
      error: {
        message: "An unexpected error occurred",
        code: "INTERNAL_ERROR",
      },
    });
  });
}
