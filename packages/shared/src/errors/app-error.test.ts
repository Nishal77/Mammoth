import { describe, it, expect } from "vitest";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  RateLimitError,
  AgentCostLimitError,
  OptimisticLockError,
} from "./app-error.ts";

// These error classes are mapped to HTTP status codes in the Fastify error handler.
// Wrong statusCode here = wrong HTTP response to clients.

describe("AppError", () => {
  it("is an instance of Error", () => {
    const err = new AppError("oops", "OOPS", 500);
    expect(err).toBeInstanceOf(Error);
  });

  it("stores message, code, and statusCode", () => {
    const err = new AppError("something failed", "INTERNAL", 500);
    expect(err.message).toBe("something failed");
    expect(err.code).toBe("INTERNAL");
    expect(err.statusCode).toBe(500);
  });

  it("captures a stack trace", () => {
    const err = new AppError("err", "CODE", 500);
    expect(err.stack).toBeDefined();
  });
});

describe("NotFoundError", () => {
  it("returns 404", () => {
    expect(new NotFoundError("Company").statusCode).toBe(404);
  });

  it("includes the resource name in the message", () => {
    const err = new NotFoundError("Company");
    expect(err.message).toContain("Company");
  });

  it("includes the id when provided", () => {
    const err = new NotFoundError("Company", "abc-123");
    expect(err.message).toContain("abc-123");
  });
});

describe("UnauthorizedError", () => {
  it("returns 401", () => {
    expect(new UnauthorizedError().statusCode).toBe(401);
  });

  it("uses a default message", () => {
    expect(new UnauthorizedError().message).toBe("Authentication required");
  });

  it("accepts a custom message", () => {
    const err = new UnauthorizedError("Token expired");
    expect(err.message).toBe("Token expired");
  });
});

describe("ForbiddenError", () => {
  it("returns 403", () => {
    expect(new ForbiddenError().statusCode).toBe(403);
  });
});

describe("ConflictError", () => {
  it("returns 409", () => {
    expect(new ConflictError("Company").statusCode).toBe(409);
  });

  it("includes the identifier in the message", () => {
    const err = new ConflictError("Company", "acme");
    expect(err.message).toContain("acme");
  });
});

describe("ValidationError", () => {
  it("returns 422", () => {
    expect(new ValidationError("Invalid email").statusCode).toBe(422);
  });

  it("uses code VALIDATION_ERROR", () => {
    expect(new ValidationError("bad").code).toBe("VALIDATION_ERROR");
  });
});

describe("RateLimitError", () => {
  it("returns 429", () => {
    expect(new RateLimitError().statusCode).toBe(429);
  });
});

describe("AgentCostLimitError", () => {
  it("returns 402", () => {
    expect(new AgentCostLimitError("comp-1").statusCode).toBe(402);
  });

  it("includes the company ID in the message", () => {
    const err = new AgentCostLimitError("comp-abc");
    expect(err.message).toContain("comp-abc");
  });

  it("uses code AGENT_COST_LIMIT", () => {
    expect(new AgentCostLimitError("comp-1").code).toBe("AGENT_COST_LIMIT");
  });
});

describe("OptimisticLockError", () => {
  it("returns 409", () => {
    expect(new OptimisticLockError("Company").statusCode).toBe(409);
  });

  it("tells the user to reload and retry", () => {
    const err = new OptimisticLockError("Goal");
    expect(err.message.toLowerCase()).toContain("reload");
  });
});
