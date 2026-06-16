import { io, type Socket } from "socket.io-client";
import type { MammothEvent } from "@mammoth/shared/events";

let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(window.location.origin, {
    path: "/socket.io",
    auth: { token },
    transports: ["websocket"],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  return socket;
}

export function subscribeCompany(
  socket: Socket,
  companyId: string
): void {
  socket.emit("subscribe:company", companyId);
}

export function onMammothEvent(
  socket: Socket,
  handler: (event: MammothEvent) => void
): () => void {
  const events: MammothEvent["event"][] = [
    "task:started",
    "task:completed",
    "task:failed",
    "agent:thinking",
    "approval:created",
    "approval:expired",
    "metric:updated",
    "briefing:ready",
    "ceo:cycle:completed",
  ];

  for (const eventName of events) {
    socket.on(eventName, (payload: MammothEvent) => handler(payload));
  }

  return () => {
    for (const eventName of events) {
      socket.off(eventName);
    }
  };
}
