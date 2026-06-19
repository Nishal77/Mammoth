import { Resend } from "resend";
import { requireDispatchContext } from "@mammoth/shared/security";

// Single Resend instance — created lazily so the module doesn't crash
// when imported in test environments without RESEND_API_KEY
let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env["RESEND_API_KEY"];
    if (!apiKey) throw new Error("RESEND_API_KEY environment variable is required");
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

const FROM_ADDRESS = process.env["EMAIL_FROM"] ?? "MAMMOTH <noreply@mammoth.dev>";

export type EmailOptions = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback for email clients that block HTML */
  text: string;
};

export type EmailResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: string };

/**
 * Sends a transactional email via Resend.
 * Never throws — returns a result type so callers can decide how to handle failures.
 *
 * @param options - Recipient, subject, and HTML/text body
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  requireDispatchContext();
  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_ADDRESS,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      return { sent: false, reason: error.message };
    }

    return { sent: true, messageId: data?.id ?? "unknown" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown email error";
    return { sent: false, reason };
  }
}

/**
 * Sends the daily briefing as an email.
 * Called when the founder has email notifications enabled and no Telegram/WhatsApp.
 */
export async function sendBriefingEmail(options: {
  to: string;
  founderName: string;
  briefingDate: string;
  summary: string;
  mrr: string;
  goal: string;
  pendingApprovals: number;
}): Promise<EmailResult> {
  const pendingSection =
    options.pendingApprovals > 0
      ? `<p><strong>${options.pendingApprovals} approval${options.pendingApprovals === 1 ? "" : "s"} pending</strong> — log in to review.</p>`
      : "";

  return sendEmail({
    to: options.to,
    subject: `MAMMOTH briefing — ${options.briefingDate}`,
    html: `
      <p>Hi ${options.founderName},</p>
      <p>${options.summary}</p>
      <table>
        <tr><td><strong>MRR</strong></td><td>${options.mrr}</td></tr>
        <tr><td><strong>Goal</strong></td><td>${options.goal}</td></tr>
      </table>
      ${pendingSection}
      <p>— MAMMOTH</p>
    `,
    text: [
      `Hi ${options.founderName},`,
      options.summary,
      `MRR: ${options.mrr}`,
      `Goal: ${options.goal}`,
      options.pendingApprovals > 0
        ? `${options.pendingApprovals} approval(s) pending — log in to review.`
        : "",
      "— MAMMOTH",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

/**
 * Sends an approval request notification by email.
 * Used as a last resort when neither Telegram nor WhatsApp is configured.
 */
export async function sendApprovalEmail(options: {
  to: string;
  founderName: string;
  approvalId: string;
  department: string;
  actionType: string;
  ringLevel: number;
  expiresAt: Date | null;
}): Promise<EmailResult> {
  const expiry = options.expiresAt
    ? `Veto by: ${options.expiresAt.toUTCString()}`
    : "No auto-execution veto window";

  return sendEmail({
    to: options.to,
    subject: `[MAMMOTH] Ring ${options.ringLevel} approval needed — ${options.department}`,
    html: `
      <p>Hi ${options.founderName},</p>
      <p>Your <strong>${options.department}</strong> agent wants to perform: <strong>${options.actionType}</strong></p>
      <p>${expiry}</p>
      <p>Log in to MAMMOTH to approve or veto this action.</p>
      <p>— MAMMOTH</p>
    `,
    text: [
      `Hi ${options.founderName},`,
      `${options.department} wants to: ${options.actionType}`,
      expiry,
      "Log in to MAMMOTH to approve or veto.",
      "— MAMMOTH",
    ].join("\n\n"),
  });
}
