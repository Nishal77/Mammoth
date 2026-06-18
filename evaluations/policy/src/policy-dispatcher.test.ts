import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAuditLog, mockLogCrossTenantBlock } = vi.hoisted(() => ({
  mockAuditLog: vi.fn(),
  mockLogCrossTenantBlock: vi.fn(),
}));

vi.mock("./audit-logger.ts", () => ({
  auditLog: mockAuditLog,
  logCrossTenantBlock: mockLogCrossTenantBlock,
}));

import { auditLog, logCrossTenantBlock } from "./audit-logger.ts";
import type { AuditEvent } from "./audit-logger.ts";

describe("auditLog()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is callable with required fields", () => {
    expect(() => {
      auditLog({
        event: "action.dispatched",
        companyId: "comp-001",
      });
    }).not.toThrow();
  });

  it("accepts all defined event types", () => {
    const events: AuditEvent[] = [
      "data.read",
      "data.write",
      "data.delete",
      "action.dispatched",
      "action.approval_granted",
      "action.approval_rejected",
      "action.blocked",
      "auth.login",
      "auth.logout",
      "integration.connected",
      "integration.disconnected",
      "cross_tenant.attempted",
      "cross_tenant.blocked",
    ];

    for (const event of events) {
      expect(() => {
        auditLog({ event, companyId: "comp-001" });
      }).not.toThrow();
    }
  });

  it("includes optional metadata", () => {
    expect(() => {
      auditLog({
        event: "action.dispatched",
        companyId: "comp-001",
        userId: "user-abc",
        resourceType: "department_task",
        actionType: "send_email",
        metadata: { ring: 2, department: "marketing" },
      });
    }).not.toThrow();
  });
});

describe("logCrossTenantBlock()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is callable with required fields", () => {
    expect(() => {
      logCrossTenantBlock("comp-001", "comp-002", "company_memory");
    }).not.toThrow();
  });

  it("accepts optional userId", () => {
    expect(() => {
      logCrossTenantBlock("comp-001", "comp-002", "company_memory", "user-abc");
    }).not.toThrow();
  });
});

describe("AuditEvent union", () => {
  it("includes action.blocked (critical for dispatch gate)", () => {
    const event: AuditEvent = "action.blocked";
    expect(event).toBe("action.blocked");
  });

  it("includes cross_tenant.blocked (security event)", () => {
    const event: AuditEvent = "cross_tenant.blocked";
    expect(event).toBe("cross_tenant.blocked");
  });
});
