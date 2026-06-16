"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { getSocket, subscribeCompany, onMammothEvent } from "@/lib/socket-client";
import type { MammothEvent } from "@mammoth/shared/events";

type ActivityItem = {
  id: string;
  text: string;
  at: Date;
  type: "task" | "approval" | "ceo";
};

export function LiveActivityBar() {
  const { data: session } = useSession();
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    // Better Auth session token — stored in session.session.token
    const token = (session?.session as { token?: string } | undefined)?.token;
    if (!token) return;

    const socket = getSocket(token);
    const companyId = (session?.user as { companyId?: string } | undefined)?.companyId;
    if (!companyId) return;

    subscribeCompany(socket, companyId);

    return onMammothEvent(socket, (event: MammothEvent) => {
      const item = toActivityItem(event);
      if (!item) return;
      setActivity((prev) => [item, ...prev].slice(0, 8));
    });
  }, [session]);

  if (activity.length === 0) return null;

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        padding: "6px 32px",
        display: "flex",
        gap: 24,
        overflowX: "auto",
        background: "var(--surface)",
      }}
    >
      {activity.map((item) => (
        <span key={item.id} style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--text-subtle)", marginRight: 8 }}>
            {formatTime(item.at)}
          </span>
          {item.text}
        </span>
      ))}
    </div>
  );
}

function toActivityItem(event: MammothEvent): ActivityItem | null {
  const id = `${event.event}-${Date.now()}-${Math.random()}`;
  const at = new Date();

  if (event.event === "task:started") {
    return { id, at, type: "task", text: `${event.department} started ${event.title}` };
  }
  if (event.event === "task:completed") {
    return { id, at, type: "task", text: `${event.department} completed task` };
  }
  if (event.event === "approval:created") {
    return { id, at, type: "approval", text: `Ring ${event.ring} approval — ${event.department} ${event.actionType.replace(/_/g, " ")}` };
  }
  if (event.event === "ceo:cycle:completed") {
    return { id, at, type: "ceo", text: `CEO Brain cycle complete — ${event.priorities.length} priorities set` };
  }
  return null;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
