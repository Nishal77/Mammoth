import { vi } from "vitest";

/**
 * Global test setup — runs before every test file in apps/api.
 *
 * Provides two things:
 *   1. Environment variables that guard against module-level throws (e.g. auth.ts).
 *   2. Global vi.mock() calls for infrastructure packages that open connections
 *      at import time — BullMQ, Better Auth, and agent-base.
 *
 * Per-test mocks (DB, auth session behavior) are in individual test files.
 */

// ── Required env vars ────────────────────────────────────────────────────────
// Prevents auth.ts from throwing at module load time when BETTER_AUTH_SECRET is absent.
process.env["BETTER_AUTH_SECRET"] = "test-secret-do-not-use-in-production";
process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test";
process.env["REDIS_HOST"] = "localhost";
process.env["REDIS_PORT"] = "6379";

// ── BullMQ ───────────────────────────────────────────────────────────────────
// approvals-route.ts creates Queue instances at module import time.
// Without this mock, every test file using buildTestApp() would fail with
// a Redis connection error before any test runs.
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: "test-job-id" }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  Worker: vi.fn(),
}));

// ── Better Auth ───────────────────────────────────────────────────────────────
// auth.ts calls betterAuth() at module level to set up DB-backed sessions.
// Mocking the package returns a safe no-op object.
// Route test files further override the getSession behavior via vi.hoisted().
vi.mock("better-auth", () => ({
  betterAuth: vi.fn().mockReturnValue({
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
    handler: vi.fn(),
  }),
}));

// ── Agent base ───────────────────────────────────────────────────────────────
// @mammoth/agent-base imports DB and model APIs at module load.
// approvals-route.ts calls writeLearningSignal() as a non-blocking side effect.
vi.mock("@mammoth/agent-base", () => ({
  writeLearningSignal: vi.fn().mockResolvedValue(0),
  MIN_SIGNALS_FOR_SYNTHESIS: 5,
}));

// ── Memory database schema subpath ───────────────────────────────────────────
// companies-route.ts imports DEPARTMENT_NAMES from "@mammoth/memory-database/schema".
// This is a constant — mock it once globally.
vi.mock("@mammoth/memory-database/schema", () => ({
  DEPARTMENT_NAMES: [
    "ceo",
    "marketing",
    "sales",
    "engineering",
    "support",
    "finance",
    "research",
    "hr",
    "content",
  ] as const,
}));
