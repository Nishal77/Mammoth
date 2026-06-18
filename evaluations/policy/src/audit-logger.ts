/**
 * Structured audit log for sensitive data operations.
 * Every cross-tenant boundary crossing, data read, and external action dispatch
 * is recorded here. Audit logs are append-only and are never deleted.
 *
 * In production these stream to a separate immutable log store (CloudWatch Logs
 * with a resource policy that prevents deletion, or Datadog).
 * In development they go to stdout with a distinct [AUDIT] prefix.
 */

export type AuditEvent =
  | "data.read"
  | "data.write"
  | "data.delete"
  | "action.dispatched"
  | "action.approval_granted"
  | "action.approval_rejected"
  | "action.blocked"
  | "auth.login"
  | "auth.logout"
  | "integration.connected"
  | "integration.disconnected"
  | "cross_tenant.attempted"
  | "cross_tenant.blocked";

export type AuditLogEntry = {
  event: AuditEvent;
  companyId: string;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  actionType?: string;
  metadata?: Record<string, string | number | boolean>;
  timestamp: string;
};

/**
 * Records an auditable event.
 * Non-blocking — audit failures must never crash business logic.
 * In production, replace the console output with your log shipper.
 *
 * @param entry - Structured audit event to record
 */
export function auditLog(
  entry: Omit<AuditLogEntry, "timestamp">
): void {
  const record: AuditLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  // Structured JSON to stdout — picked up by log aggregators in production
  process.stdout.write(`[AUDIT] ${JSON.stringify(record)}\n`);
}

/**
 * Logs a cross-tenant access attempt that was blocked.
 * Critical security event — should trigger alerts in production.
 *
 * @param callerCompanyId    - The company making the request
 * @param targetCompanyId    - The company whose data was requested
 * @param resourceType       - What was being accessed
 * @param callerUserId       - Optional user ID if request came via API
 */
export function logCrossTenantBlock(
  callerCompanyId: string,
  targetCompanyId: string,
  resourceType: string,
  callerUserId?: string
): void {
  const entry: Omit<AuditLogEntry, "timestamp"> = {
    event: "cross_tenant.blocked",
    companyId: callerCompanyId,
    resourceType,
    metadata: {
      // Only log the first 8 chars of the target ID — enough for debugging, not full exposure
      targetCompanyIdPrefix: targetCompanyId.slice(0, 8),
      blocked: true,
    },
  };

  if (callerUserId) entry.userId = callerUserId;

  auditLog({
    ...entry,
  });
}
