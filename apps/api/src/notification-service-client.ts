import { redis } from "@mammoth/db";
import { randomBytes } from "crypto";

const CONNECT_TOKEN_TTL_SECONDS = 60 * 10;
const CONNECT_TOKEN_PREFIX = "telegram:connect:";

/**
 * Generates a one-time Telegram connect token for a user.
 * Stored in Redis; consumed by the notification service /start handler.
 * Duplicated here so the API does not import from the notification service.
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
