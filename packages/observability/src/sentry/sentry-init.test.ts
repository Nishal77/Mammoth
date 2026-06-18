import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @sentry/node before importing our module.
// This prevents any real HTTP calls to Sentry servers during tests.
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (scope: unknown) => void) => {
    fn({ setTag: vi.fn() });
  }),
  flush: vi.fn().mockResolvedValue(true),
  httpIntegration: vi.fn().mockReturnValue({}),
  nodeContextIntegration: vi.fn().mockReturnValue({}),
}));

import * as Sentry from "@sentry/node";
import { initSentry, captureError, flushSentry } from "./sentry-init.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initSentry", () => {
  it("calls Sentry.init when DSN is provided", () => {
    initSentry({
      dsn: "https://abc123@o0.ingest.sentry.io/0",
      serviceName: "api",
      environment: "test",
    });
    expect(Sentry.init).toHaveBeenCalledOnce();
  });

  it("does NOT call Sentry.init when DSN is undefined", () => {
    initSentry({
      dsn: undefined,
      serviceName: "api",
      environment: "development",
    });
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("passes the service name as a tag in initialScope", () => {
    initSentry({
      dsn: "https://abc@sentry.io/1",
      serviceName: "agent-worker",
      environment: "production",
    });

    const callArg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(callArg.initialScope.tags.service).toBe("agent-worker");
  });

  it("uses the provided tracesSampleRate", () => {
    initSentry({
      dsn: "https://abc@sentry.io/1",
      serviceName: "api",
      environment: "production",
      tracesSampleRate: 0.5,
    });

    const callArg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(callArg.tracesSampleRate).toBe(0.5);
  });

  it("defaults tracesSampleRate to 0.1 when not specified", () => {
    initSentry({
      dsn: "https://abc@sentry.io/1",
      serviceName: "api",
      environment: "production",
    });

    const callArg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(callArg.tracesSampleRate).toBe(0.1);
  });
});

describe("captureError", () => {
  it("calls Sentry.withScope to attach context", () => {
    const error = new Error("database timeout");
    captureError(error, { companyId: "comp-1", actionType: "sync" });
    expect(Sentry.withScope).toHaveBeenCalledOnce();
  });

  it("works with an empty context object", () => {
    const error = new Error("generic error");
    expect(() => captureError(error)).not.toThrow();
    expect(Sentry.withScope).toHaveBeenCalledOnce();
  });
});

describe("flushSentry", () => {
  it("calls Sentry.flush with a timeout", async () => {
    await flushSentry();
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });
});
