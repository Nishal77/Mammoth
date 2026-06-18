import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Resend so tests don't make real HTTP calls
vi.mock("resend", () => {
  const mockSend = vi.fn();
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: mockSend },
    })),
    _mockSend: mockSend,
  };
});

import { sendEmail, sendBriefingEmail, sendApprovalEmail } from "./email-sender.ts";
import * as resendMock from "resend";

const mockSend = (resendMock as Record<string, unknown>)["_mockSend"] as ReturnType<typeof vi.fn>;

describe("sendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["RESEND_API_KEY"] = "re_test_key";
  });

  it("returns sent=true with messageId on success", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "msg-123" }, error: null });

    const result = await sendEmail({
      to: "founder@acme.com",
      subject: "Test subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result.sent).toBe(true);
    if (result.sent) {
      expect(result.messageId).toBe("msg-123");
    }
  });

  it("returns sent=false when Resend returns an error", async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid email address" },
    });

    const result = await sendEmail({
      to: "bad-email",
      subject: "Test",
      html: "<p>test</p>",
      text: "test",
    });

    expect(result.sent).toBe(false);
    if (!result.sent) {
      expect(result.reason).toContain("Invalid email address");
    }
  });

  it("returns sent=false when Resend throws (network error)", async () => {
    mockSend.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await sendEmail({
      to: "founder@acme.com",
      subject: "Test",
      html: "<p>test</p>",
      text: "test",
    });

    expect(result.sent).toBe(false);
    if (!result.sent) {
      expect(result.reason).toContain("ECONNREFUSED");
    }
  });

  it("never throws — always returns a result", async () => {
    mockSend.mockRejectedValueOnce(new TypeError("totally broken"));

    await expect(
      sendEmail({ to: "a@b.com", subject: "s", html: "h", text: "t" })
    ).resolves.toBeDefined();
  });
});

describe("sendBriefingEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["RESEND_API_KEY"] = "re_test_key";
  });

  it("includes founder name in the email", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "msg-abc" }, error: null });

    await sendBriefingEmail({
      to: "ceo@acme.com",
      founderName: "Alice",
      briefingDate: "2026-06-16",
      summary: "3 new leads today",
      mrr: "$24,500",
      goal: "$100k ARR",
      pendingApprovals: 1,
    });

    const callArgs = mockSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(callArgs?.["html"])).toContain("Alice");
    expect(String(callArgs?.["text"])).toContain("Alice");
  });

  it("includes pending approvals when count > 0", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "msg-abc" }, error: null });

    await sendBriefingEmail({
      to: "ceo@acme.com",
      founderName: "Bob",
      briefingDate: "2026-06-16",
      summary: "Good day",
      mrr: "$5,000",
      goal: "$50k ARR",
      pendingApprovals: 3,
    });

    const callArgs = mockSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(callArgs?.["html"])).toContain("3 approval");
  });

  it("omits pending approvals section when count is 0", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "msg-abc" }, error: null });

    await sendBriefingEmail({
      to: "ceo@acme.com",
      founderName: "Carol",
      briefingDate: "2026-06-16",
      summary: "Quiet day",
      mrr: "$2,000",
      goal: "$20k ARR",
      pendingApprovals: 0,
    });

    const callArgs = mockSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(callArgs?.["html"])).not.toContain("approval");
  });
});

describe("sendApprovalEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["RESEND_API_KEY"] = "re_test_key";
  });

  it("includes ring level and department in subject", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "id" }, error: null });

    await sendApprovalEmail({
      to: "ceo@acme.com",
      founderName: "Dave",
      approvalId: "appr-123",
      department: "Marketing",
      actionType: "publish_ad_campaign",
      ringLevel: 2,
      expiresAt: new Date("2026-06-17T10:00:00Z"),
    });

    const callArgs = mockSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(callArgs?.["subject"])).toContain("Ring 2");
    expect(String(callArgs?.["subject"])).toContain("Marketing");
  });

  it("shows 'No auto-execution veto window' when expiresAt is null", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "id" }, error: null });

    await sendApprovalEmail({
      to: "ceo@acme.com",
      founderName: "Eve",
      approvalId: "appr-456",
      department: "Sales",
      actionType: "send_outreach",
      ringLevel: 3,
      expiresAt: null,
    });

    const callArgs = mockSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(callArgs?.["html"])).toContain("No auto-execution veto window");
  });
});
