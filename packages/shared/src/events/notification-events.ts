/**
 * Events published to Redis channel `notifications:dispatch`.
 * Agent-worker and API publish; notification-service subscribes.
 * Keeps services decoupled — no direct cross-app imports.
 */

export type NotificationApprovalCreatedEvent = {
  type: "approval_created";
  userId: string;
  approvalId: string;
};

export type NotificationVetoAlertEvent = {
  type: "veto_alert";
  userId: string;
  approvalId: string;
  minutesLeft: number;
};

export type NotificationBriefingReadyEvent = {
  type: "briefing_ready";
  userId: string;
  briefingId: string;
};

export type NotificationEvent =
  | NotificationApprovalCreatedEvent
  | NotificationVetoAlertEvent
  | NotificationBriefingReadyEvent;

export const NOTIFICATION_CHANNEL = "notifications:dispatch";
