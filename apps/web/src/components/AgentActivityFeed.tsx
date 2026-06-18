"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getSocket, subscribeCompany, onMammothEvent } from "@/lib/socket-client";
import type {
  MammothEvent,
  TaskStartedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  ApprovalCreatedEvent,
} from "@mammoth/shared/events";

type RunningTask = {
  taskId: string;
  department: string;
  title: string;
  startedAt: Date;
};

type FeedItem =
  | { type: "started"; taskId: string; department: string; title: string; at: Date }
  | { type: "completed"; taskId: string; department: string; preview: string; at: Date; approvalId?: string }
  | { type: "failed"; taskId: string; department: string; error: string; at: Date }
  | { type: "approval"; approvalId: string; ring: 1 | 2 | 3; department: string; actionType: string; at: Date };

export type AgentActivityFeedHandle = {
  onEvent: (event: MammothEvent) => void;
};

type Props = {
  companyId: string;
  token: string;
  onApprovalCreated?: () => void;
};

/**
 * Real-time agent activity feed.
 * Shows in-progress tasks and a rolling log of recent agent events.
 * Subscribes via Socket.IO using the Better Auth session token.
 */
export function AgentActivityFeed({ companyId, token, onApprovalCreated }: Props) {
  const [running, setRunning] = useState<RunningTask[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const handleEvent = useCallback((event: MammothEvent) => {
    const at = new Date();

    if (event.event === "task:started") {
      const e = event as TaskStartedEvent;
      setRunning((prev) => [
        { taskId: e.taskId, department: e.department, title: e.title, startedAt: at },
        ...prev.filter((t) => t.taskId !== e.taskId),
      ]);
      const startedItem: FeedItem = { type: "started", taskId: e.taskId, department: e.department, title: e.title, at };
      setFeed((prev) => [startedItem, ...prev.slice(0, 19)]);
      return;
    }

    if (event.event === "task:completed") {
      const e = event as TaskCompletedEvent;
      setRunning((prev) => prev.filter((t) => t.taskId !== e.taskId));
      const completedItem: FeedItem = {
        type: "completed",
        taskId: e.taskId,
        department: e.department,
        preview: e.outputPreview,
        at,
        ...(e.approvalId !== undefined ? { approvalId: e.approvalId } : {}),
      };
      setFeed((prev) => [completedItem, ...prev.slice(0, 19)]);
      return;
    }

    if (event.event === "task:failed") {
      const e = event as TaskFailedEvent;
      setRunning((prev) => prev.filter((t) => t.taskId !== e.taskId));
      const failedItem: FeedItem = { type: "failed", taskId: e.taskId, department: e.department, error: e.error, at };
      setFeed((prev) => [failedItem, ...prev.slice(0, 19)]);
      return;
    }

    if (event.event === "approval:created") {
      const e = event as ApprovalCreatedEvent;
      const approvalItem: FeedItem = { type: "approval", approvalId: e.approvalId, ring: e.ring, department: e.department, actionType: e.actionType, at };
      setFeed((prev) => [approvalItem, ...prev.slice(0, 19)]);
      onApprovalCreated?.();
    }
  }, [onApprovalCreated]);

  useEffect(() => {
    if (!token || !companyId) return;
    const socket = getSocket(token);
    subscribeCompany(socket, companyId);
    return onMammothEvent(socket, handleEvent);
  }, [token, companyId, handleEvent]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {running.length > 0 && (
        <div>
          <SectionLabel>Running now</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {running.map((t) => (
              <RunningTaskRow key={t.taskId} task={t} />
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Recent activity</SectionLabel>
        {feed.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
            Waiting for agent activity...
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {feed.map((item, i) => (
              <FeedRow key={i} item={item} companyId={companyId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunningTaskRow({ task }: { task: RunningTask }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 5,
      }}
    >
      <PulsingDot />
      <span style={{ color: "var(--text)", fontSize: 12, textTransform: "capitalize", flex: 1 }}>
        {task.department}
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
        {task.title.replace(/_/g, " ")}
      </span>
      <span style={{ color: "var(--text-subtle)", fontSize: 10 }}>
        {formatElapsed(task.startedAt)}
      </span>
    </div>
  );
}

function FeedRow({ item, companyId }: { item: FeedItem; companyId: string }) {
  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "7px 0",
    borderBottom: "1px solid var(--border)",
  };

  if (item.type === "started") {
    return (
      <div style={baseStyle}>
        <EventDot color="var(--blue)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "capitalize" }}>
            {item.department}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}> started </span>
          <span style={{ color: "var(--text)", fontSize: 11 }}>
            {item.title.replace(/_/g, " ")}
          </span>
        </div>
        <time style={{ color: "var(--text-subtle)", fontSize: 10, flexShrink: 0 }}>
          {formatTime(item.at)}
        </time>
      </div>
    );
  }

  if (item.type === "completed") {
    return (
      <div style={baseStyle}>
        <EventDot color="var(--green)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "capitalize" }}>
            {item.department}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}> completed</span>
          {item.approvalId && (
            <Link
              href={`/approvals?company=${companyId}&approvalId=${item.approvalId}`}
              style={{ color: "var(--yellow)", fontSize: 11, marginLeft: 6, textDecoration: "none" }}
            >
              needs approval
            </Link>
          )}
          {!item.approvalId && item.preview && (
            <p style={{ margin: "2px 0 0", color: "var(--text-subtle)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.preview}
            </p>
          )}
        </div>
        <time style={{ color: "var(--text-subtle)", fontSize: 10, flexShrink: 0 }}>
          {formatTime(item.at)}
        </time>
      </div>
    );
  }

  if (item.type === "failed") {
    return (
      <div style={baseStyle}>
        <EventDot color="var(--red)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "capitalize" }}>
            {item.department}
          </span>
          <span style={{ color: "var(--red)", fontSize: 11 }}> failed: {item.error.slice(0, 60)}</span>
        </div>
        <time style={{ color: "var(--text-subtle)", fontSize: 10, flexShrink: 0 }}>
          {formatTime(item.at)}
        </time>
      </div>
    );
  }

  if (item.type === "approval") {
    return (
      <div style={baseStyle}>
        <EventDot color="var(--yellow)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link
            href={`/approvals?company=${companyId}&approvalId=${item.approvalId}`}
            style={{ color: "var(--text)", fontSize: 11, textDecoration: "none" }}
          >
            <span style={{ color: "var(--yellow)", marginRight: 4 }}>Ring {item.ring}</span>
            <span style={{ textTransform: "capitalize" }}>{item.department}</span>
            {" — "}
            {item.actionType.replace(/_/g, " ")}
          </Link>
        </div>
        <time style={{ color: "var(--text-subtle)", fontSize: 10, flexShrink: 0 }}>
          {formatTime(item.at)}
        </time>
      </div>
    );
  }

  return null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        color: "var(--text-muted)",
        fontSize: 10,
        fontWeight: 400,
        letterSpacing: "0.1em",
        margin: "0 0 10px",
        textTransform: "uppercase",
      }}
    >
      {children}
    </p>
  );
}

function PulsingDot() {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: "var(--blue)",
        flexShrink: 0,
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

function EventDot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        marginTop: 3,
      }}
    />
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatElapsed(startedAt: Date): string {
  const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
}
