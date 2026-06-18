import { telegramBot } from "./telegram-bot.ts";
import { db, users } from "@mammoth/memory-database";
import { eq } from "drizzle-orm";
import { redis } from "@mammoth/memory-database";
import { randomBytes } from "crypto";

const CONNECT_TOKEN_TTL_SECONDS = 60 * 10; // 10 minutes
const CONNECT_TOKEN_PREFIX = "telegram:connect:";

/**
 * Generates a one-time token that maps to a MAMMOTH userId.
 * The founder visits the bot link with this token as a start parameter.
 * Token expires in 10 minutes.
 */
export async function generateTelegramConnectToken(
  userId: string
): Promise<{ token: string; botLink: string }> {
  const token = randomBytes(16).toString("hex");
  const botUsername = process.env["TELEGRAM_BOT_USERNAME"];

  if (!botUsername) {
    throw new Error("TELEGRAM_BOT_USERNAME environment variable is required");
  }

  await redis.set(
    `${CONNECT_TOKEN_PREFIX}${token}`,
    userId,
    "EX",
    CONNECT_TOKEN_TTL_SECONDS
  );

  return {
    token,
    botLink: `https://t.me/${botUsername}?start=${token}`,
  };
}

/**
 * Registers the /start command handler on the Telegram bot.
 * When a founder clicks the connect link, this stores their chatId.
 * Called once at service startup.
 */
export function registerTelegramStartHandler(): void {
  telegramBot.command("start", async (ctx) => {
    const token = ctx.match?.trim();

    if (!token) {
      await ctx.reply(
        "Welcome to MAMMOTH. Connect your account at app.mammoth.dev to link this chat."
      );
      return;
    }

    const userId = await redis.get(`${CONNECT_TOKEN_PREFIX}${token}`);

    if (!userId) {
      await ctx.reply("This link has expired. Generate a new one from your MAMMOTH settings.");
      return;
    }

    const telegramChatId = String(ctx.chat.id);

    await db
      .update(users)
      .set({ telegramChatId })
      .where(eq(users.id, userId));

    await redis.del(`${CONNECT_TOKEN_PREFIX}${token}`);

    const firstName = ctx.from?.first_name ?? "there";
    await ctx.reply(
      `Hi ${firstName}, your Telegram is now connected to MAMMOTH.\n\n` +
      `You will receive approval requests, veto alerts, and morning briefings here.\n\n` +
      `Reply HELP at any time for available commands.`
    );
  });

  telegramBot.command("help", async (ctx) => {
    await ctx.reply(
      `MAMMOTH commands:\n\n` +
      `/modify <approvalId> <content> — submit a modified version of a pending approval\n\n` +
      `Approval requests include inline buttons. Tap Approve or Reject directly.`
    );
  });
}
