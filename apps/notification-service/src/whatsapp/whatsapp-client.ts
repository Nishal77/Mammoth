/**
 * WhatsApp Business Cloud API client.
 * Used as secondary notification channel when founder prefers WhatsApp.
 *
 * Approval actions via WhatsApp use reply keywords:
 *   APPROVE <approvalId>
 *   REJECT  <approvalId>
 *   MODIFY  <approvalId>  (followed by modified content in next message)
 *
 * Full inline buttons are not available on WhatsApp Cloud API outside
 * of template messages — keyword replies are the standard pattern.
 */

const WA_API_BASE = "https://graph.facebook.com/v20.0";

type WhatsAppTextMessage = {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: { body: string };
};

async function sendWhatsAppMessage(
  phone: string,
  body: string
): Promise<void> {
  const token = process.env["META_WHATSAPP_TOKEN"];
  const phoneId = process.env["META_WHATSAPP_PHONE_ID"];

  if (!token || !phoneId) {
    throw new Error(
      "META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_ID are required"
    );
  }

  const message: WhatsAppTextMessage = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body },
  };

  const response = await fetch(`${WA_API_BASE}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${errText}`);
  }
}

/**
 * Sends an approval request via WhatsApp.
 * Includes reply instructions since WA lacks inline keyboards outside templates.
 */
export async function sendWhatsAppApproval(
  phone: string,
  approvalData: {
    approvalId: string;
    department: string;
    actionType: string;
    ringLevel: number;
    outputContent: string;
    confidence: number;
    expiresAt: Date | null;
  }
): Promise<void> {
  const preview =
    approvalData.outputContent.length > 400
      ? approvalData.outputContent.slice(0, 397) + "..."
      : approvalData.outputContent;

  const ringNote =
    approvalData.ringLevel === 2
      ? "Auto-approves in 4h if no action."
      : "Requires your decision.";

  const body = [
    `MAMMOTH — ${approvalData.department.toUpperCase()} ACTION NEEDED`,
    `Type: ${approvalData.actionType.replace(/_/g, " ")}`,
    `Confidence: ${Math.round(approvalData.confidence * 100)}%`,
    ringNote,
    "",
    preview,
    "",
    `Reply with:`,
    `APPROVE ${approvalData.approvalId}`,
    `REJECT ${approvalData.approvalId}`,
  ].join("\n");

  await sendWhatsAppMessage(phone, body);
}

/**
 * Sends the daily briefing via WhatsApp.
 */
export async function sendWhatsAppBriefing(
  phone: string,
  briefing: {
    summary: string;
    mrr: string;
    goal: string;
    pendingApprovals: number;
    briefingDate: string;
  }
): Promise<void> {
  const body = [
    `MAMMOTH Morning Briefing — ${briefing.briefingDate}`,
    "",
    briefing.summary,
    "",
    `MRR: ${briefing.mrr}  |  Goal: ${briefing.goal}`,
    briefing.pendingApprovals > 0
      ? `\n${briefing.pendingApprovals} item(s) waiting for your decision.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  await sendWhatsAppMessage(phone, body);
}

/**
 * Sends a veto alert when Ring 2 window is closing.
 */
export async function sendWhatsAppVetoAlert(
  phone: string,
  approvalData: {
    approvalId: string;
    department: string;
    actionType: string;
    minutesLeft: number;
  }
): Promise<void> {
  const body = [
    `MAMMOTH — Veto window closing in ${approvalData.minutesLeft} minutes`,
    `${approvalData.department} wants to ${approvalData.actionType.replace(/_/g, " ")}.`,
    `No action = auto-approved.`,
    "",
    `Reply REJECT ${approvalData.approvalId} to block it.`,
  ].join("\n");

  await sendWhatsAppMessage(phone, body);
}
