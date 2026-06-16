import type { Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import Redis from "ioredis";
import type { MammothEvent } from "@mammoth/shared/events";
import { SOCKET_EVENT_CHANNEL_PREFIX } from "@mammoth/db";
import { auth } from "./auth.ts";

let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
      credentials: true,
    },
    path: "/socket.io",
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth["token"] as string | undefined;
      if (!token) return next(new Error("Authentication required"));

      const headers = new Headers({ authorization: `Bearer ${token}` });
      const session = await auth.api.getSession({ headers });

      if (!session?.user) return next(new Error("Invalid session"));

      socket.data["userId"] = session.user.id;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data["userId"] as string;

    // Client subscribes to a company room
    socket.on("subscribe:company", (companyId: string) => {
      // Rooms are namespaced by userId to prevent cross-tenant leakage
      const room = `company:${companyId}:user:${userId}`;
      socket.join(room);
    });

    socket.on("unsubscribe:company", (companyId: string) => {
      const room = `company:${companyId}:user:${userId}`;
      socket.leave(room);
    });
  });

  subscribeToAgentEvents(io);

  return io;
}

/**
 * Subscribes to Redis pub/sub for agent-worker events.
 * Agent-worker publishes to `socket:events:{companyId}`; this relays to Socket.io rooms.
 */
function subscribeToAgentEvents(socketServer: SocketServer): void {
  if (!process.env["REDIS_URL"]) return;

  const subscriber = new Redis(process.env["REDIS_URL"]);

  subscriber.psubscribe(`${SOCKET_EVENT_CHANNEL_PREFIX}*`, (err) => {
    if (err) {
      console.error("[socket] Redis psubscribe failed:", err.message);
    }
  });

  subscriber.on(
    "pmessage",
    (_pattern: string, channel: string, message: string) => {
      const companyId = channel.replace(SOCKET_EVENT_CHANNEL_PREFIX, "");
      let parsed: { ownerId: string; event: MammothEvent };

      try {
        parsed = JSON.parse(message) as typeof parsed;
      } catch {
        return;
      }

      emitToCompany(companyId, parsed.ownerId, parsed.event);
    }
  );

  subscriber.on("error", (err) => {
    console.error("[socket] Subscriber error:", err.message);
  });
}

export function emitToCompany(
  companyId: string,
  userId: string,
  event: MammothEvent
): void {
  if (!io) return;
  const room = `company:${companyId}:user:${userId}`;
  io.to(room).emit(event.event, event);
}

export function getSocketServer(): SocketServer {
  if (!io) throw new Error("Socket server not initialised");
  return io;
}
