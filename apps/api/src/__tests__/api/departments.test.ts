/**
 * Integration tests for the departments route.
 * Covers: list all, update playbook/ring defaults, list tasks, list outputs.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  TEST_USER_ID,
  TEST_COMPANY_ID,
  TEST_DEPT_NAME,
  TEST_COMPANY,
  TEST_DEPARTMENT,
} from "../setup/fixtures.ts";
import { makeTestChain } from "../setup/db-mock.ts";

// ── Mocks ──────────────────────────────────────────────────────────────────

const { mockDb, mockGetSession } = vi.hoisted(() => {
  const mkChain = (v: unknown = undefined): any => {
    const c: any = {
      values: vi.fn(), set: vi.fn(), where: vi.fn(),
      returning: vi.fn().mockResolvedValue(Array.isArray(v) ? v : []),
      onConflictDoUpdate: vi.fn(),
      then: (res: any, rej?: any) => Promise.resolve(v).then(res, rej),
    };
    c.values.mockReturnValue(c); c.set.mockReturnValue(c);
    c.where.mockReturnValue(c); c.onConflictDoUpdate.mockReturnValue(c);
    return c;
  };
  const db: any = {
    query: {
      companies:       { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      companyGoals:    { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      approvals:       { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      companyMemory:   { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      departments:     { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      departmentTasks: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      trustScores:     { findFirst: vi.fn().mockResolvedValue(null) },
      briefings:       { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: vi.fn().mockReturnValue(mkChain([])),
    update: vi.fn().mockReturnValue(mkChain()),
    delete: vi.fn().mockReturnValue(mkChain()),
    transaction: vi.fn().mockImplementation(async (fn: any) => fn(db)),
  };
  return { mockDb: db, mockGetSession: vi.fn() };
});

vi.mock("@mammoth/memory-database", () => ({
  db: mockDb,
  companies: {}, departments: {}, companyGoals: {}, approvals: {},
  companyMemory: {}, departmentTasks: {}, trustScores: {}, briefings: {},
  checkAndPromoteTrustScore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/auth.ts", () => ({
  auth: { api: { getSession: mockGetSession } },
}));

vi.mock("drizzle-orm", () => ({
  eq:    vi.fn((a, b) => ({ a, b })),
  and:   vi.fn((...args) => args),
  isNull: vi.fn((a) => a),
  desc:  vi.fn((a) => a),
  asc:   vi.fn((a) => a),
  lt:    vi.fn((a, b) => ({ a, b })),
  ilike: vi.fn((a, b) => ({ a, b })),
  sql:   Object.assign(vi.fn(), { raw: vi.fn() }),
}));

// ── App setup ──────────────────────────────────────────────────────────────
import { buildTestApp } from "../setup/test-app.ts";

let app: FastifyInstance;

beforeAll(async () => { app = await buildTestApp(); });
afterAll(async () => { await app.close(); });

beforeEach(() => {
  mockGetSession.mockResolvedValue({
    user: { id: TEST_USER_ID, email: "test@mammoth.test" },
  });
  mockDb.query.companies.findFirst.mockResolvedValue(TEST_COMPANY);
});

// ── Helpers ────────────────────────────────────────────────────────────────

const url = (suffix = "") => `/api/v1/companies/${TEST_COMPANY_ID}/departments${suffix}`;

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  payload: JSON.stringify(body),
});

// ── GET /departments ───────────────────────────────────────────────────────

describe("GET /departments", () => {
  it("returns 200 with all departments", async () => {
    mockDb.query.departments.findMany.mockResolvedValue([TEST_DEPARTMENT]);

    const res = await app.inject({ method: "GET", url: url() });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].name).toBe("sales");
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(401);
  });
});

// ── PATCH /departments/:deptName ───────────────────────────────────────────

describe("PATCH /departments/:deptName", () => {
  beforeEach(() => {
    // Playbook update: route does findFirst to get playbookVersion, then update
    mockDb.query.departments.findFirst.mockResolvedValue(TEST_DEPARTMENT);
    mockDb.update.mockReturnValue(
      makeTestChain([{ ...TEST_DEPARTMENT, playbook: "Updated playbook" }])
    );
  });

  it("returns 200 on valid playbook update", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_DEPT_NAME}`),
      ...json({ playbook: "New sales playbook content" }),
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 200 on ring defaults update", async () => {
    const updatedDept = { ...TEST_DEPARTMENT, ringDefaults: { defaultRing: 3 } };
    mockDb.update.mockReturnValue(makeTestChain([updatedDept]));

    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_DEPT_NAME}`),
      ...json({ ringDefaults: { defaultRing: 3 } }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.ringDefaults.defaultRing).toBe(3);
  });

  it("returns 422 when department name is not a valid department", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: url("/legal"),
      ...json({ playbook: "New playbook" }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when department does not exist for this company", async () => {
    mockDb.update.mockReturnValue(makeTestChain([]));

    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_DEPT_NAME}`),
      ...json({ playbook: "New playbook" }),
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── GET /departments/:deptName/tasks ───────────────────────────────────────

describe("GET /departments/:deptName/tasks", () => {
  it("returns 200 with task list for the department", async () => {
    mockDb.query.departments.findFirst.mockResolvedValue(TEST_DEPARTMENT);
    mockDb.query.departmentTasks.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: url(`/${TEST_DEPT_NAME}/tasks`),
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 404 when department name does not exist in this company", async () => {
    mockDb.query.departments.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: url(`/${TEST_DEPT_NAME}/tasks`),
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── GET /departments/:deptName/outputs ─────────────────────────────────────

describe("GET /departments/:deptName/outputs", () => {
  it("returns 200 with completed task outputs", async () => {
    const completedTask = {
      id: "task-001",
      taskType: "send_email_campaign",
      outputContent: "Email content",
      completedAt: new Date("2026-01-15"),
    };
    mockDb.query.departments.findFirst.mockResolvedValue(TEST_DEPARTMENT);
    mockDb.query.departmentTasks.findMany.mockResolvedValue([completedTask]);

    const res = await app.inject({
      method: "GET",
      url: url(`/${TEST_DEPT_NAME}/outputs`),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("returns 404 when department does not exist", async () => {
    mockDb.query.departments.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: url(`/${TEST_DEPT_NAME}/outputs`),
    });

    expect(res.statusCode).toBe(404);
  });
});
