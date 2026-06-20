import { Bot, InlineKeyboard, type Context } from "grammy";
import { db, approvals, users } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";
import { NotFoundError, ForbiddenError } from "@mammoth/shared/errors";

if (!process.env["TELEGRAM_BOT_TOKEN"]) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

export const telegramBot = new Bot(process.env["TELEGRAM_BOT_TOKEN"]);

// Callback data format: mammoth:{action}:{approvalId}
// Actions: approve | reject | modify_request
const CALLBACK_PREFIX = "mammoth";

type ApprovalAction = "approve" | "reject" | "modify_request";

/**
 * Sends an approval request to the founder's Telegram chat.
 * Includes inline buttons for approve, reject, and request modification.
 * Ring 2 messages include the auto-approve countdown.
 *
 * @param chatId - Founder's Telegram chat ID (stored on users.telegramChatId)
 * @param approval - Approval record with content and metadata
 */
export async function sendApprovalRequest(
  chatId: string,
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
  const ringLabel =
    approvalData.ringLevel === 2
      ? "Ring 2 — auto-approves in 4h"
      : "Ring 3 — requires your approval";

  const preview =
    approvalData.outputContent.length > 600
      ? approvalData.outputContent.slice(0, 597) + "..."
      : approvalData.outputContent;

  const text = [
    `*${approvalData.department.toUpperCase()} — ${approvalData.actionType.replace(/_/g, " ")}*`,
    `Confidence: ${Math.round(approvalData.confidence * 100)}%  |  ${ringLabel}`,
    "",
    "```",
    preview,
    "```",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("Approve", buildCallbackData("approve", approvalData.approvalId))
    .text("Reject", buildCallbackData("reject", approvalData.approvalId))
    .row()
    .text("Request Edit", buildCallbackData("modify_request", approvalData.approvalId));

  await telegramBot.api.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

/**
 * Sends the daily morning briefing to the founder's Telegram chat.
 */
export async function sendBriefing(
  chatId: string,
  briefing: {
    summary: string;
    mrr: string;
    goal: string;
    pendingApprovals: number;
    briefingDate: string;
  }
): Promise<void> {
  const text = [
    `*MAMMOTH Morning Briefing — ${briefing.briefingDate}*`,
    "",
    briefing.summary,
    "",
    `MRR: *${briefing.mrr}*  |  Goal: ${briefing.goal}`,
    briefing.pendingApprovals > 0
      ? `\n*${briefing.pendingApprovals} item(s) waiting for your decision.*`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  await telegramBot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/**
 * Sends a Ring 2 auto-approve warning 30 minutes before expiry.
 */
export async function sendVetoAlert(
  chatId: string,
  approvalData: {
    approvalId: string;
    department: string;
    actionType: string;
    minutesLeft: number;
  }
): Promise<void> {
  const text =
    `*Veto window closing in ${approvalData.minutesLeft} minutes*\n` +
    `${approvalData.department} wants to ${approvalData.actionType.replace(/_/g, " ")}.\n` +
    `No action = auto-approved.`;

  const keyboard = new InlineKeyboard()
    .text("Approve now", buildCallbackData("approve", approvalData.approvalId))
    .text("Reject", buildCallbackData("reject", approvalData.approvalId));

  await telegramBot.api.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

// ─── Callback handler (inline button presses) ───────────────────────────────

telegramBot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data.startsWith(CALLBACK_PREFIX)) return;

  const [, action, approvalId] = data.split(":");
  if (!action || !approvalId) return;

  const telegramUserId = String(ctx.from.id);

  try {
    await handleApprovalCallback(
      ctx,
      telegramUserId,
      approvalId,
      action as ApprovalAction
    );
  } catch (error) {
    await ctx.answerCallbackQuery({
      text: error instanceof Error ? error.message : "Error processing request",
      show_alert: true,
    });
  }
});

// Prompt for modification text
telegramBot.on("message:text", async (ctx) => {
  const text = ctx.message.text;

  // Format: /modify <approvalId> <modified content...>
  if (text.startsWith("/modify ")) {
    const firstSpace = text.indexOf(" ");
    const secondSpace = text.indexOf(" ", firstSpace + 1);
    if (secondSpace === -1) {
      await ctx.reply("Usage: /modify <approvalId> <your modified content>");
      return;
    }

    const approvalId = text.slice(firstSpace + 1, secondSpace);
    const modifiedContent = text.slice(secondSpace + 1);

    const telegramUserId = String(ctx.from.id);
    await resolveApprovalFromTelegram(
      telegramUserId,
      approvalId,
      "modified",
      modifiedContent
    );
    await ctx.reply("Modification saved.");
  }
});

async function handleApprovalCallback(
  ctx: Context,
  telegramUserId: string,
  approvalId: string,
  action: ApprovalAction
): Promise<void> {
  if (action === "modify_request") {
    await ctx.answerCallbackQuery({ text: "Send: /modify <approvalId> <your edited version>" });
    await ctx.reply(
      `To modify, send:\n\`/modify ${approvalId} <your edited content here>\``,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const newStatus = action === "approve" ? "approved" : "rejected";
  await resolveApprovalFromTelegram(telegramUserId, approvalId, newStatus);
  await ctx.answerCallbackQuery({
    text: `${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}.`,
  });
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  await ctx.reply(`Approval ${newStatus}.`);
}

async function resolveApprovalFromTelegram(
  telegramUserId: string,
  approvalId: string,
  status: "approved" | "rejected" | "modified",
  modifiedContent?: string
): Promise<void> {
  // Map Telegram user to MAMMOTH user
  const user = await db.query.users.findFirst({
    where: eq(users.telegramChatId, telegramUserId),
    columns: { id: true },
  });

  if (!user) {
    throw new NotFoundError(
      "No MAMMOTH account linked to this Telegram account"
    );
  }

  const approval = await db.query.approvals.findFirst({
    where: and(
      eq(approvals.id, approvalId),
      eq(approvals.status, "pending")
    ),
    columns: { id: true, companyId: true, status: true, expiresAt: true },
  });

  if (!approval) throw new NotFoundError("Approval", approvalId);
  if (approval.expiresAt && approval.expiresAt < new Date()) {
    throw new ForbiddenError("Approval window has expired");
  }

  await db
    .update(approvals)
    .set({
      status,
      resolvedBy: user.id,
      resolvedAt: new Date(),
      modifiedContent: modifiedContent ?? null,
      updatedAt: new Date(),
    })
    .where(eq(approvals.id, approvalId));
}

function buildCallbackData(action: ApprovalAction, approvalId: string): string {
  return `${CALLBACK_PREFIX}:${action}:${approvalId}`;
}
