/**
 * Integration tests for the company goals route.
 * Covers: list, create, update — including validation and ownership enforcement.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  TEST_USER_ID,
  TEST_COMPANY_ID,
  TEST_GOAL_ID,
  TEST_COMPANY,
  TEST_GOAL,
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

const url = (suffix = "") => `/api/v1/companies/${TEST_COMPANY_ID}/goals${suffix}`;

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  payload: JSON.stringify(body),
});

const VALID_GOAL_INPUT = {
  title: "Reach $1M ARR",
  type: "revenue",
  targetValue: "1000000",
  unit: "USD",
  deadline: "2026-12-31",
};

// ── GET /goals ─────────────────────────────────────────────────────────────

describe("GET /goals", () => {
  it("returns 200 with goal list", async () => {
    mockDb.query.companyGoals.findMany.mockResolvedValue([TEST_GOAL]);

    const res = await app.inject({ method: "GET", url: url() });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].id).toBe(TEST_GOAL_ID);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(401);
  });

  it("returns empty array when company has no goals", async () => {
    mockDb.query.companyGoals.findMany.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

// ── POST /goals ────────────────────────────────────────────────────────────

describe("POST /goals", () => {
  beforeEach(() => {
    mockDb.insert.mockReturnValue(makeTestChain([TEST_GOAL]));
  });

  it("returns 201 with created goal on valid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json(VALID_GOAL_INPUT),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBe(TEST_GOAL_ID);
    expect(res.json().data.type).toBe("revenue");
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json(VALID_GOAL_INPUT),
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 422 when title is missing", async () => {
    const { title: _t, ...withoutTitle } = VALID_GOAL_INPUT;

    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json(withoutTitle),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 when type is not a valid enum value", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ ...VALID_GOAL_INPUT, type: "acquisition" }),
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 when deadline is not ISO date format", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ ...VALID_GOAL_INPUT, deadline: "next-year" }),
    });
    expect(res.statusCode).toBe(422);
  });
});

// ── PATCH /goals/:goalId ───────────────────────────────────────────────────

describe("PATCH /goals/:goalId", () => {
  it("returns 200 on valid update", async () => {
    mockDb.update.mockReturnValue(makeTestChain([{ ...TEST_GOAL, status: "paused" }]));

    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_GOAL_ID}`),
      ...json({ status: "paused" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("paused");
  });

  it("returns 404 when goal does not exist", async () => {
    // update.returning() returns [] → NotFoundError
    mockDb.update.mockReturnValue(makeTestChain([]));

    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_GOAL_ID}`),
      ...json({ status: "paused" }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 422 when status is not a valid enum value", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_GOAL_ID}`),
      ...json({ status: "cancelled" }),
    });
    expect(res.statusCode).toBe(422);
  });
});
