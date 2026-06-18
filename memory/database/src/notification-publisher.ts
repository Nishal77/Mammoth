import { redis } from "./redis.ts";
import type { NotificationEvent } from "@mammoth/shared/events";
import { NOTIFICATION_CHANNEL } from "@mammoth/shared/events";

/**
 * Publishes a notification event to Redis channel `notifications:dispatch`.
 * The notification service subscribes and routes to Telegram/WhatsApp.
 * Never throws — publish failures are logged and swallowed.
 */
export async function publishNotification(
  event: NotificationEvent
): Promise<void> {
  try {
    await redis.publish(NOTIFICATION_CHANNEL, JSON.stringify(event));
  } catch (error) {
    console.error(
      "[notification-publisher] Failed to publish notification event:",
      { type: event.type, error: error instanceof Error ? error.message : error }
    );
  }
}
