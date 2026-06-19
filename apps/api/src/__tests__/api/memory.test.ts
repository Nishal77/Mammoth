/**
 * Integration tests for the company memory route.
 * Covers: list (with/without type filter), create, update, delete, search.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  TEST_USER_ID,
  TEST_COMPANY_ID,
  TEST_COMPANY,
  TEST_MEMORY_ENTRY,
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

const url = (suffix = "") => `/api/v1/companies/${TEST_COMPANY_ID}/memory${suffix}`;

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  payload: JSON.stringify(body),
});

const VALID_MEMORY_INPUT = {
  memoryType: "identity",
  key: "company-mission",
  value: "Build the world's best AI OS",
  source: "onboarding",
};

// ── GET /memory ────────────────────────────────────────────────────────────

describe("GET /memory", () => {
  it("returns 200 with all memory entries", async () => {
    mockDb.query.companyMemory.findMany.mockResolvedValue([TEST_MEMORY_ENTRY]);

    const res = await app.inject({ method: "GET", url: url() });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].memoryType).toBe("identity");
  });

  it("returns 200 filtered by type query param", async () => {
    mockDb.query.companyMemory.findMany.mockResolvedValue([TEST_MEMORY_ENTRY]);

    const res = await app.inject({ method: "GET", url: url("?type=identity") });

    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].memoryType).toBe("identity");
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(401);
  });
});

// ── POST /memory ───────────────────────────────────────────────────────────

describe("POST /memory", () => {
  beforeEach(() => {
    mockDb.query.companyMemory.findFirst.mockResolvedValue(null);
    mockDb.insert.mockReturnValue(makeTestChain([TEST_MEMORY_ENTRY]));
  });

  it("returns 201 on valid create", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json(VALID_MEMORY_INPUT),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.key).toBe("company-mission");
  });

  it("returns 409 when key already exists for this type", async () => {
    mockDb.query.companyMemory.findFirst.mockResolvedValue(TEST_MEMORY_ENTRY);

    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json(VALID_MEMORY_INPUT),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("returns 422 when memoryType is not a valid enum value", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ ...VALID_MEMORY_INPUT, memoryType: "unknown_type" }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 when key is missing", async () => {
    const { key: _k, ...withoutKey } = VALID_MEMORY_INPUT;

    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json(withoutKey),
    });

    expect(res.statusCode).toBe(422);
  });
});

// ── PATCH /memory/:id ─────────────────────────────────────────────────────

describe("PATCH /memory/:id", () => {
  it("returns 200 on valid update", async () => {
    const updated = { ...TEST_MEMORY_ENTRY, value: "New mission statement" };
    mockDb.update.mockReturnValue(makeTestChain([updated]));

    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_MEMORY_ENTRY.id}`),
      ...json({ value: "New mission statement" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.value).toBe("New mission statement");
  });

  it("returns 404 when memory entry does not exist", async () => {
    mockDb.update.mockReturnValue(makeTestChain([]));

    const res = await app.inject({
      method: "PATCH",
      url: url("/nonexistent-id"),
      ...json({ value: "Updated" }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

// ── DELETE /memory/:id ─────────────────────────────────────────────────────

describe("DELETE /memory/:id", () => {
  it("returns 204 on successful delete", async () => {
    mockDb.delete.mockReturnValue(makeTestChain([{ id: TEST_MEMORY_ENTRY.id }]));

    const res = await app.inject({
      method: "DELETE",
      url: url(`/${TEST_MEMORY_ENTRY.id}`),
    });

    expect(res.statusCode).toBe(204);
  });

  it("returns 404 when memory entry does not exist", async () => {
    mockDb.delete.mockReturnValue(makeTestChain([]));

    const res = await app.inject({
      method: "DELETE",
      url: url("/nonexistent-id"),
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── GET /memory/search ─────────────────────────────────────────────────────

describe("GET /memory/search", () => {
  it("returns 200 with matching entries", async () => {
    mockDb.query.companyMemory.findMany.mockResolvedValue([TEST_MEMORY_ENTRY]);

    const res = await app.inject({ method: "GET", url: url("/search?q=mission") });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("returns 422 when query is less than 2 characters", async () => {
    const res = await app.inject({ method: "GET", url: url("/search?q=a") });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 when query param is missing", async () => {
    const res = await app.inject({ method: "GET", url: url("/search") });

    expect(res.statusCode).toBe(422);
  });
});
