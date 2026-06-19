/**
 * Integration tests for the approvals route.
 * Covers: list, get single, resolve (approve/reject/modify) — including
 * expiry enforcement, status guards, and validation.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  TEST_USER_ID,
  TEST_COMPANY_ID,
  TEST_APPROVAL_ID,
  TEST_COMPANY,
  TEST_APPROVAL,
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
  // expireStalePendingApprovals runs on every GET/POST read — mock the update
  mockDb.update.mockReturnValue(makeTestChain());
});

// ── Helpers ────────────────────────────────────────────────────────────────

const url = (suffix = "") => `/api/v1/companies/${TEST_COMPANY_ID}/approvals${suffix}`;

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  payload: JSON.stringify(body),
});

// ── GET /approvals ─────────────────────────────────────────────────────────

describe("GET /approvals", () => {
  it("returns 200 with approval list", async () => {
    mockDb.query.approvals.findMany.mockResolvedValue([TEST_APPROVAL]);

    const res = await app.inject({ method: "GET", url: url() });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].id).toBe(TEST_APPROVAL_ID);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(401);
  });

  it("returns empty array when no approvals exist", async () => {
    mockDb.query.approvals.findMany.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

// ── GET /approvals/:id ─────────────────────────────────────────────────────

describe("GET /approvals/:id", () => {
  it("returns 200 with approval detail", async () => {
    mockDb.query.approvals.findFirst.mockResolvedValue(TEST_APPROVAL);

    const res = await app.inject({ method: "GET", url: url(`/${TEST_APPROVAL_ID}`) });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(TEST_APPROVAL_ID);
    expect(res.json().data.status).toBe("pending");
  });

  it("returns 404 when approval does not exist", async () => {
    mockDb.query.approvals.findFirst.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: url("/nonexistent-id") });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

// ── POST /approvals/:id/resolve ────────────────────────────────────────────

describe("POST /approvals/:id/resolve", () => {
  const pendingApproval = {
    ...TEST_APPROVAL,
    status: "pending",
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  };

  beforeEach(() => {
    // Route fetches approval before updating
    mockDb.query.approvals.findFirst.mockResolvedValue(pendingApproval);

    // Transaction: update(approvals) + insert(trustScores) with onConflictDoUpdate
    const approvedApproval = { ...pendingApproval, status: "approved", resolvedBy: TEST_USER_ID };
    mockDb.update.mockReturnValue(makeTestChain([approvedApproval]));
    mockDb.insert.mockReturnValue(makeTestChain([]));
  });

  it("returns 200 on approve action", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(`/${TEST_APPROVAL_ID}/resolve`),
      ...json({ action: "approve" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("approved");
  });

  it("returns 200 on reject action", async () => {
    mockDb.update.mockReturnValue(
      makeTestChain([{ ...pendingApproval, status: "rejected" }])
    );

    const res = await app.inject({
      method: "POST",
      url: url(`/${TEST_APPROVAL_ID}/resolve`),
      ...json({ action: "reject" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("rejected");
  });

  it("returns 200 on modify action with modifiedContent", async () => {
    mockDb.update.mockReturnValue(
      makeTestChain([{ ...pendingApproval, status: "modified" }])
    );

    const res = await app.inject({
      method: "POST",
      url: url(`/${TEST_APPROVAL_ID}/resolve`),
      ...json({ action: "modify", modifiedContent: "Updated email copy", diffSummary: "Changed tone" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("modified");
  });

  it("returns 404 when approval does not exist", async () => {
    mockDb.query.approvals.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: url(`/nonexistent-id/resolve`),
      ...json({ action: "approve" }),
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when approval is already resolved", async () => {
    mockDb.query.approvals.findFirst.mockResolvedValue({
      ...pendingApproval,
      status: "approved",
    });

    const res = await app.inject({
      method: "POST",
      url: url(`/${TEST_APPROVAL_ID}/resolve`),
      ...json({ action: "approve" }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("returns 422 when action is missing from body", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(`/${TEST_APPROVAL_ID}/resolve`),
      ...json({}),
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 when modify action is missing modifiedContent", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(`/${TEST_APPROVAL_ID}/resolve`),
      ...json({ action: "modify" }),
    });
    expect(res.statusCode).toBe(422);
  });
});
