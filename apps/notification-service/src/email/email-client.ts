import { Resend } from "resend";

if (!process.env["RESEND_API_KEY"]) {
  throw new Error("RESEND_API_KEY environment variable is required");
}

const resend = new Resend(process.env["RESEND_API_KEY"]);

const FROM_ADDRESS = "MAMMOTH <noreply@mammoth.dev>";

/**
 * Sends transactional email for account events only.
 * Notifications and approvals go through Telegram/WhatsApp — not email.
 * Email covers: welcome, password reset, billing alerts.
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

export async function sendWelcomeEmail(
  to: string,
  name: string
): Promise<void> {
  await sendEmail({
    to,
    subject: "Welcome to MAMMOTH",
    html: `<p>Hi ${name},</p><p>Your autonomous company OS is ready. Connect Telegram or WhatsApp during onboarding to start receiving approvals and briefings.</p>`,
    text: `Hi ${name}, your autonomous company OS is ready. Connect Telegram or WhatsApp during onboarding.`,
  });
}

export async function sendCostLimitAlert(
  to: string,
  companyName: string,
  dailyCap: number
): Promise<void> {
  await sendEmail({
    to,
    subject: `[MAMMOTH] Daily AI cost limit reached — ${companyName}`,
    html: `<p>Your company <strong>${companyName}</strong> has reached its daily AI cost cap of $${dailyCap}. Agents are paused until midnight UTC.</p><p>Increase the cap in Settings → Billing.</p>`,
    text: `${companyName} has reached its daily AI cost cap of $${dailyCap}. Agents are paused until midnight UTC.`,
  });
}
