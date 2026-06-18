import { redis } from "./redis.ts";
import type { MammothEvent } from "@mammoth/shared/events";

export const SOCKET_EVENT_CHANNEL_PREFIX = "socket:events:";

/**
 * Publishes a real-time event to Redis.
 * The API socket server subscribes and relays events to Socket.io rooms.
 * Keeps agent-worker decoupled from the API process.
 */
export async function publishSocketEvent(
  companyId: string,
  ownerId: string,
  event: MammothEvent
): Promise<void> {
  try {
    await redis.publish(
      `${SOCKET_EVENT_CHANNEL_PREFIX}${companyId}`,
      JSON.stringify({ ownerId, event })
    );
  } catch (error) {
    console.error("[socket-publisher] Failed to publish socket event:", {
      companyId,
      eventType: event.event,
      error: error instanceof Error ? error.message : error,
    });
  }
}
