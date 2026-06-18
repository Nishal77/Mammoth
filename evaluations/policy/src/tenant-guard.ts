/**
 * Tenant isolation guard — prevents cross-company data access.
 *
 * OpenClaw-style vulnerability: AI agents that gain access to system-level context
 * can read data belonging to other tenants. This guard enforces hard boundaries.
 *
 * Every function that touches company-scoped data MUST call assertCompanyOwnership
 * before processing. The agent run context already carries companyId — this just
 * makes the boundary explicit and throws early on any mismatch.
 */

import { ForbiddenError } from "@mammoth/shared/errors";

/**
 * Asserts that the resourceCompanyId matches the callerCompanyId.
 * Throws ForbiddenError immediately on mismatch — never returns silently.
 *
 * @param resourceCompanyId - The companyId embedded in the data being accessed
 * @param callerCompanyId   - The companyId from the authenticated caller context
 * @param resourceType      - Human-readable resource name for error messages
 */
export function assertCompanyOwnership(
  resourceCompanyId: string,
  callerCompanyId: string,
  resourceType = "resource"
): void {
  if (resourceCompanyId !== callerCompanyId) {
    // Never expose the actual IDs in the error message — that leaks tenant info
    throw new ForbiddenError(
      `Cross-tenant access denied: ${resourceType} does not belong to this company`
    );
  }
}

/**
 * Validates that a companyId is a valid UUID format before using it in queries.
 * Prevents injection via malformed companyId values.
 *
 * @param companyId - The company ID to validate
 */
export function validateCompanyId(companyId: string): void {
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!UUID_PATTERN.test(companyId)) {
    throw new ForbiddenError("Invalid company ID format");
  }
}

/**
 * Scrubs any data that might contain cross-tenant references before logging.
 * Replaces UUID-shaped strings that aren't the caller's own companyId with [REDACTED].
 * Used in audit log entries to prevent accidental tenant ID leakage.
 *
 * @param data      - The object to sanitize
 * @param ownerId   - The only companyId that is allowed to appear in the output
 */
export function sanitizeForAuditLog(
  data: Record<string, unknown>,
  ownerId: string
): Record<string, unknown> {
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (
      typeof value === "string" &&
      UUID_PATTERN.test(value) &&
      value !== ownerId
    ) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
