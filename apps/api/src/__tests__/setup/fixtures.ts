/**
 * Shared test data used across all integration test files.
 * All IDs are deterministic so assertions are unambiguous.
 */

export const TEST_USER_ID = "user-integration-test-01";
export const TEST_USER_EMAIL = "integration@mammoth.test";

export const TEST_COMPANY_ID = "company-integration-test-01";
export const TEST_COMPANY_SLUG = "test-co-integration";
export const OTHER_COMPANY_ID = "company-other-user-99";

export const TEST_GOAL_ID = "goal-integration-test-01";
export const TEST_APPROVAL_ID = "approval-integration-test-01";
export const TEST_DEPT_NAME = "sales";

/** Minimal company row returned by requireCompanyAccess and GET routes. */
export const TEST_COMPANY = {
  id: TEST_COMPANY_ID,
  ownerId: TEST_USER_ID,
  name: "Integration Test Co",
  slug: TEST_COMPANY_SLUG,
  tagline: "Testing is good",
  industry: "SaaS",
  stage: "early-revenue",
  version: 1,
  brandVoice: null,
  description: null,
  website: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

export const TEST_GOAL = {
  id: TEST_GOAL_ID,
  companyId: TEST_COMPANY_ID,
  title: "Reach $1M ARR",
  type: "revenue",
  targetValue: "1000000",
  currentValue: "50000",
  unit: "USD",
  deadline: "2026-12-31",
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

export const TEST_APPROVAL = {
  id: TEST_APPROVAL_ID,
  companyId: TEST_COMPANY_ID,
  taskId: "task-001",
  department: "marketing",
  actionType: "send_email_campaign",
  ringLevel: 2,
  status: "pending",
  outputContent: "Draft email content",
  expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  resolvedBy: null,
  resolvedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  task: { id: "task-001", taskType: "send_email_campaign", departmentId: "dept-001" },
};

export const TEST_MEMORY_ENTRY = {
  id: "memory-integration-test-01",
  companyId: TEST_COMPANY_ID,
  memoryType: "identity",
  key: "company-mission",
  value: "Build the world's best AI OS",
  source: "onboarding",
  confidence: "0.95",
  expiresAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

export const TEST_DEPARTMENT = {
  id: "dept-sales-001",
  companyId: TEST_COMPANY_ID,
  name: "sales",
  status: "active",
  playbook: null,
  playbookVersion: 1,
  ringDefaults: { defaultRing: 2 },
  config: null,
  lastRunAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};
