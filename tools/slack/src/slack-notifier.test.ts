import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWithDispatchContext } from "@mammoth/shared/security";

// We test the message construction logic without actually calling the Slack API.
// The WebClient is mocked so tests run offline and don't burn API quota.

vi.mock("@slack/web-api", () => {
  const mockPostMessage = vi.fn();
  const mockAuthTest = vi.fn();

  return {
    WebClient: vi.fn().mockImplementation(() => ({
      chat: { postMessage: mockPostMessage },
      auth: { test: mockAuthTest },
    })),
    _mockPostMessage: mockPostMessage,
    _mockAuthTest: mockAuthTest,
  };
});

import { sendApprovalToSlack, sendBriefingToSlack, verifySlackToken } from "./slack-notifier.ts";
import * as slackMock from "@slack/web-api";

const mockPostMessage = (slackMock as Record<string, unknown>)["_mockPostMessage"] as ReturnType<typeof vi.fn>;
const mockAuthTest = (slackMock as Record<string, unknown>)["_mockAuthTest"] as ReturnType<typeof vi.fn>;

const testCtx = { approvalId: "test-appr", companyId: "test-co", actionType: "send_slack" };

describe("sendApprovalToSlack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sent=true with messageTs on success", async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "1234567890.123456" });

    const result = await runWithDispatchContext(testCtx, () =>
      sendApprovalToSlack("xoxb-token", "#approvals", {
        approvalId: "approval-abc",
        department: "Marketing",
        actionType: "publish_blog_post",
        ringLevel: 2,
        outputContent: "Publishing: '10 growth hacks for B2B SaaS'",
        confidence: 0.85,
        expiresAt: new Date("2026-06-16T12:00:00Z"),
      })
    );

    expect(result.sent).toBe(true);
    if (result.sent) {
      expect(result.messageTs).toBe("1234567890.123456");
    }
    expect(mockPostMessage).toHaveBeenCalledOnce();
  });

  it("returns sent=false when Slack API throws", async () => {
    mockPostMessage.mockRejectedValueOnce(new Error("channel_not_found"));

    const result = await runWithDispatchContext(testCtx, () =>
      sendApprovalToSlack("xoxb-token", "#nonexistent", {
        approvalId: "approval-xyz",
        department: "Sales",
        actionType: "send_outreach",
        ringLevel: 2,
        outputContent: "Hi there",
        confidence: 0.9,
        expiresAt: null,
      })
    );

    expect(result.sent).toBe(false);
    if (!result.sent) {
      expect(result.reason).toContain("channel_not_found");
    }
  });

  it("truncates long output content to 500 chars", async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "ts" });

    const longContent = "x".repeat(1000);
    await runWithDispatchContext(testCtx, () =>
      sendApprovalToSlack("xoxb-token", "#ch", {
        approvalId: "id",
        department: "Engineering",
        actionType: "merge_pr",
        ringLevel: 2,
        outputContent: longContent,
        confidence: 0.8,
        expiresAt: null,
      })
    );

    const callArgs = mockPostMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    const blocks = callArgs?.["blocks"] as Array<Record<string, unknown>>;
    const contentBlock = blocks?.find(
      (b) => (b["text"] as Record<string, unknown>)?.["text"] !== undefined &&
             typeof (b["text"] as Record<string, unknown>)?.["text"] === "string" &&
             ((b["text"] as Record<string, unknown>)?.["text"] as string).includes("x".repeat(10))
    );

    expect(contentBlock).toBeDefined();
    const textContent = (contentBlock?.["text"] as Record<string, unknown>)?.["text"] as string;
    expect(textContent).toContain("...");
    expect(textContent.length).toBeLessThan(600);
  });

  it("shows 'No veto window' when expiresAt is null", async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "ts" });

    await runWithDispatchContext(testCtx, () =>
      sendApprovalToSlack("xoxb-token", "#ch", {
        approvalId: "id",
        department: "HR",
        actionType: "post_job",
        ringLevel: 2,
        outputContent: "Posting job",
        confidence: 0.7,
        expiresAt: null,
      })
    );

    const callArgs = mockPostMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    const messageJson = JSON.stringify(callArgs);
    expect(messageJson).toContain("No veto window");
  });
});

describe("sendBriefingToSlack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sent=true on success", async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "ts.123" });

    const result = await sendBriefingToSlack("xoxb-token", "#briefings", {
      summary: "Great day — 3 new leads, 1 deal closed.",
      mrr: "$24,500",
      goal: "$100k ARR by Dec 2026",
      pendingApprovals: 2,
      briefingDate: "2026-06-16",
    });

    expect(result.sent).toBe(true);
  });

  it("includes pending approvals count when non-zero", async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "ts" });

    await sendBriefingToSlack("xoxb-token", "#ch", {
      summary: "Summary",
      mrr: "$1,000",
      goal: "Goal",
      pendingApprovals: 3,
      briefingDate: "2026-06-16",
    });

    const callArgs = mockPostMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(callArgs)).toContain("3 approvals pending");
  });

  it("shows 'No pending approvals' when count is 0", async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "ts" });

    await sendBriefingToSlack("xoxb-token", "#ch", {
      summary: "Summary",
      mrr: "$1,000",
      goal: "Goal",
      pendingApprovals: 0,
      briefingDate: "2026-06-16",
    });

    const callArgs = mockPostMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(callArgs)).toContain("No pending approvals");
  });
});

describe("verifySlackToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspace name on valid token", async () => {
    mockAuthTest.mockResolvedValueOnce({ ok: true, team: "Acme Corp" });

    const workspace = await verifySlackToken("xoxb-valid-token");
    expect(workspace).toBe("Acme Corp");
  });

  it("returns null on invalid token", async () => {
    mockAuthTest.mockRejectedValueOnce(new Error("invalid_auth"));

    const workspace = await verifySlackToken("xoxb-bad-token");
    expect(workspace).toBeNull();
  });
});
