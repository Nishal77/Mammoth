import { WebClient } from "@slack/web-api";
import { requireDispatchContext } from "@mammoth/shared/security";

const REQUEST_TIMEOUT_MS = 10_000;

export type SlackApprovalMessage = {
  approvalId: string;
  department: string;
  actionType: string;
  ringLevel: number;
  outputContent: string;
  confidence: number;
  /** ISO string — when the 4-hour veto window closes */
  expiresAt: Date | null;
};

export type SlackBriefingMessage = {
  summary: string;
  mrr: string;
  goal: string;
  pendingApprovals: number;
  briefingDate: string;
};

export type SlackSendResult =
  | { sent: true; messageTs: string }
  | { sent: false; reason: string };

/**
 * Posts an approval request to a Slack channel.
 * Formats the message using Slack Block Kit for readable structure.
 * Returns the Slack message timestamp (ts) which can be used to update it later.
 *
 * @param botToken - Slack bot OAuth token (xoxb-...)
 * @param channel  - Slack channel ID or name (e.g. "#mammoth-approvals")
 * @param message  - Approval details to display
 */
export async function sendApprovalToSlack(
  botToken: string,
  channel: string,
  message: SlackApprovalMessage
): Promise<SlackSendResult> {
  requireDispatchContext();
  const client = new WebClient(botToken, { timeout: REQUEST_TIMEOUT_MS });

  const vetoCutoff = message.expiresAt
    ? `Veto by ${message.expiresAt.toUTCString()}`
    : "No veto window";

  const confidencePercent = Math.round(message.confidence * 100);

  try {
    const response = await client.chat.postMessage({
      channel,
      text: `[${message.department}] Approval needed: ${message.actionType}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `Ring ${message.ringLevel} action — ${message.department}`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Action*\n${message.actionType}` },
            { type: "mrkdwn", text: `*Confidence*\n${confidencePercent}%` },
            { type: "mrkdwn", text: `*Veto window*\n${vetoCutoff}` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*What the agent plans to do*\n${message.outputContent.slice(0, 500)}${message.outputContent.length > 500 ? "..." : ""}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Approval ID: \`${message.approvalId}\` — Approve or veto in the MAMMOTH dashboard`,
            },
          ],
        },
      ],
    });

    const messageTs = typeof response.ts === "string" ? response.ts : "";
    return { sent: true, messageTs };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Slack error";
    return { sent: false, reason };
  }
}

/**
 * Posts the daily or weekly briefing to a Slack channel.
 * Formats key metrics and any pending approvals that need attention.
 *
 * @param botToken - Slack bot OAuth token
 * @param channel  - Target Slack channel
 * @param briefing - Briefing content to send
 */
export async function sendBriefingToSlack(
  botToken: string,
  channel: string,
  briefing: SlackBriefingMessage
): Promise<SlackSendResult> {
  const client = new WebClient(botToken, { timeout: REQUEST_TIMEOUT_MS });

  const pendingText =
    briefing.pendingApprovals > 0
      ? `:bell: *${briefing.pendingApprovals} approval${briefing.pendingApprovals === 1 ? "" : "s"} pending*`
      : "No pending approvals";

  try {
    const response = await client.chat.postMessage({
      channel,
      text: `MAMMOTH daily briefing — ${briefing.briefingDate}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `MAMMOTH Briefing — ${briefing.briefingDate}`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*MRR*\n${briefing.mrr}` },
            { type: "mrkdwn", text: `*Goal*\n${briefing.goal}` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: briefing.summary,
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: pendingText }],
        },
      ],
    });

    const messageTs = typeof response.ts === "string" ? response.ts : "";
    return { sent: true, messageTs };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Slack error";
    return { sent: false, reason };
  }
}

/**
 * Verifies a Slack bot token by calling auth.test.
 * Returns the workspace name on success, or null if the token is invalid.
 */
export async function verifySlackToken(botToken: string): Promise<string | null> {
  try {
    const client = new WebClient(botToken, { timeout: REQUEST_TIMEOUT_MS });
    const response = await client.auth.test();
    return typeof response.team === "string" ? response.team : null;
  } catch {
    return null;
  }
}
