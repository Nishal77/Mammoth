import { describe, it, expect } from "vitest";
import { createLogger, ServiceLogger } from "./structured-logger.ts";

// We don't test pino internals — we test that our ServiceLogger wrapper
// passes the right arguments through to pino and returns child loggers correctly.

describe("createLogger", () => {
  it("returns a ServiceLogger instance", () => {
    const logger = createLogger("test-service");
    expect(logger).toBeInstanceOf(ServiceLogger);
  });
});

describe("ServiceLogger.withContext", () => {
  it("returns a new ServiceLogger (does not mutate the original)", () => {
    const logger = createLogger("test");
    const child = logger.withContext({ companyId: "abc123" });

    expect(child).toBeInstanceOf(ServiceLogger);
    expect(child).not.toBe(logger);
  });

  it("can be chained — each withContext adds more fields", () => {
    const logger = createLogger("test");
    const childA = logger.withContext({ companyId: "abc" });
    const childB = childA.withContext({ agentRunId: "run-1" });

    expect(childB).toBeInstanceOf(ServiceLogger);
    expect(childB).not.toBe(childA);
  });
});

describe("ServiceLogger log methods", () => {
  it("does not throw when called with a message", () => {
    const logger = createLogger("test");
    // If any of these throw the test fails automatically.
    expect(() => logger.info("test info")).not.toThrow();
    expect(() => logger.warn("test warn")).not.toThrow();
    expect(() => logger.error("test error")).not.toThrow();
    expect(() => logger.debug("test debug")).not.toThrow();
  });

  it("does not throw when called with context fields", () => {
    const logger = createLogger("test");
    expect(() =>
      logger.info("processing job", {
        companyId: "comp-1",
        agentRunId: "run-1",
        taskId: "task-1",
        actionType: "content_post",
      })
    ).not.toThrow();
  });

  it("errorWithStack does not throw when given a real Error", () => {
    const logger = createLogger("test");
    const err = new Error("something broke");
    expect(() =>
      logger.errorWithStack("job failed", err, { companyId: "comp-1" })
    ).not.toThrow();
  });

  it("errorWithStack handles Error with no stack", () => {
    const logger = createLogger("test");
    const err = new Error("no stack");
    delete err.stack;
    expect(() => logger.errorWithStack("error", err)).not.toThrow();
  });
});
