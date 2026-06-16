/**
 * All real-time events emitted via Redis pub/sub → WebSocket.
 * Server-to-client events only. Rooms are keyed by company ID.
 */

export type TaskStartedEvent = {
  event: "task:started";
  taskId: string;
  department: string;
  title: string;
};

export type TaskCompletedEvent = {
  event: "task:completed";
  taskId: string;
  department: string;
  outputPreview: string;
  approvalId?: string;
};

export type TaskFailedEvent = {
  event: "task:failed";
  taskId: string;
  department: string;
  error: string;
};

export type AgentThinkingEvent = {
  event: "agent:thinking";
  department: string;
  step: string;
  message: string;
};

export type ApprovalCreatedEvent = {
  event: "approval:created";
  approvalId: string;
  ring: 1 | 2 | 3;
  department: string;
  actionType: string;
  expiresAt?: string;
};

export type ApprovalExpiredEvent = {
  event: "approval:expired";
  approvalId: string;
};

export type MetricUpdatedEvent = {
  event: "metric:updated";
  metric: string;
  value: number;
  delta: number;
};

export type BriefingReadyEvent = {
  event: "briefing:ready";
  briefingId: string;
  summary: string;
};

export type CeoCycleCompletedEvent = {
  event: "ceo:cycle:completed";
  priorities: string[];
  alerts: string[];
};

export type MammothServerEvent =
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | AgentThinkingEvent
  | ApprovalCreatedEvent
  | ApprovalExpiredEvent
  | MetricUpdatedEvent
  | BriefingReadyEvent
  | CeoCycleCompletedEvent;

// Alias for backward compatibility in socket.ts and other consumers
export type MammothEvent = MammothServerEvent;
export type MammothEventName = MammothServerEvent["event"];
