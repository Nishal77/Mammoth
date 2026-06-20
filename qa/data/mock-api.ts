/**
 * Canonical API mock responses used across all E2E tests.
 *
 * These mirror the real API contract from apps/api (Fastify routes).
 * Envelope shape: { success: true, data: T } | { success: false, error, code }
 *
 * When the real API changes, update these mocks to match.
 */

export const MOCK_USER = {
  id: "user-e2e-001",
  email: "test@mammoth.ai",
  name: "E2E Tester",
};

export const MOCK_COMPANY = {
  id: "company-e2e-001",
  name: "Acme Corp",
  stage: "early-revenue",
  industry: "SaaS",
};

export const MOCK_GOAL = {
  id: "goal-e2e-001",
  title: "Reach $1M ARR",
  type: "revenue",
  targetValue: "1000000",
  currentValue: "250000",
  unit: "USD",
  deadline: "2026-12-31",
  status: "active",
};

export const MOCK_APPROVAL = {
  id: "approval-e2e-001",
  department: "marketing",
  actionType: "send_email_campaign",
  ringLevel: 2,
  status: "pending",
  outputContent: "Send Q3 newsletter to 5,000 subscribers",
  confidence: "0.92",
  expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

export const MOCK_DEPARTMENT = {
  id: "dept-e2e-001",
  name: "marketing",
  status: "active",
  currentTask: "Run Q3 email campaign",
  tasksCompleted: 12,
  tasksTotal: 20,
};

export const MOCK_MEMORY = {
  id: "mem-e2e-001",
  type: "identity",
  content: "Acme Corp builds AI-powered workflow tools",
  updatedAt: new Date().toISOString(),
};

/** Wrap any value in the API success envelope */
export function ok<T>(data: T) {
  return { success: true, data };
}

/** Wrap an error in the API failure envelope */
export function fail(error: string, code: string) {
  return { success: false, error, code };
}
