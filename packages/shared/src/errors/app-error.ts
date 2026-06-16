/**
 * Base error class for all MAMMOTH application errors.
 * Typed errors enable consistent HTTP status mapping in Fastify.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      "NOT_FOUND",
      404
    );
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Insufficient permissions") {
    super(message, "FORBIDDEN", 403);
  }
}

export class ConflictError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(
      identifier
        ? `${resource} '${identifier}' already exists`
        : `${resource} already exists`,
      "CONFLICT",
      409
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 422);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super(message, "RATE_LIMIT_EXCEEDED", 429);
  }
}

export class AgentCostLimitError extends AppError {
  constructor(companyId: string) {
    super(
      `Daily AI cost limit reached for company ${companyId}`,
      "AGENT_COST_LIMIT",
      402
    );
  }
}

export class OptimisticLockError extends AppError {
  constructor(resource: string) {
    super(
      `${resource} was modified by another process. Reload and retry.`,
      "OPTIMISTIC_LOCK",
      409
    );
  }
}
