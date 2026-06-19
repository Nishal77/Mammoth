/**
 * Integration tests for the companies route.
 *
 * Strategy: Fastify inject() makes HTTP requests against a real Fastify instance
 * with the DB and auth mocked. Tests verify HTTP status codes and response shapes.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  TEST_USER_ID,
  TEST_COMPANY_ID,
  TEST_COMPANY,
} from "../setup/fixtures.ts";
import { makeTestChain } from "../setup/db-mock.ts";

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// vi.hoisted() runs before any imports are resolved — it is the ONLY safe place
// to create values that are referenced inside vi.mock() factory functions.
// Never reference imported symbols inside vi.hoisted(): they don't exist yet.

const { mockDb, mockGetSession } = vi.hoisted(() => {
  // Inline Drizzle chain factory — vi.fn() is globally available during hoisting.
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
  // requireCompanyAccess: company exists and belongs to TEST_USER_ID
  mockDb.query.companies.findFirst.mockResolvedValue(TEST_COMPANY);
});

// ── Helpers ────────────────────────────────────────────────────────────────

const url = (suffix = "") => `/api/v1/companies${suffix}`;

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  payload: JSON.stringify(body),
});

// ── GET /companies ─────────────────────────────────────────────────────────

describe("GET /companies", () => {
  it("returns 200 with owned companies", async () => {
    mockDb.query.companies.findMany.mockResolvedValue([TEST_COMPANY]);

    const res = await app.inject({ method: "GET", url: url() });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].id).toBe(TEST_COMPANY_ID);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(401);
  });

  it("returns empty array when user has no companies", async () => {
    mockDb.query.companies.findMany.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

// ── POST /companies ────────────────────────────────────────────────────────

describe("POST /companies", () => {
  beforeEach(() => {
    // No slug conflict by default
    mockDb.query.companies.findFirst.mockResolvedValue(null);

    // Transaction: insert(companies).values().returning() + insert(departments).values()
    const companyChain = makeTestChain([TEST_COMPANY]);
    const deptChain = makeTestChain([]); // awaited without .returning()
    mockDb.insert
      .mockReturnValueOnce(companyChain)   // tx.insert(companies)
      .mockReturnValueOnce(deptChain);     // tx.insert(departments)
  });

  it("returns 201 with created company on valid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ name: "New Company", stage: "idea" }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBe(TEST_COMPANY_ID);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ name: "New Company" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 422 when name is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ stage: "idea" }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 when name is too short", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ name: "X" }),
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 when stage is not a valid enum value", async () => {
    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ name: "Valid Name", stage: "unicorn" }),
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 409 when slug already exists", async () => {
    // Slug conflict: findFirst returns an existing company
    mockDb.query.companies.findFirst.mockResolvedValue(TEST_COMPANY);

    const res = await app.inject({
      method: "POST",
      url: url(),
      ...json({ name: TEST_COMPANY.name }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });
});

// ── GET /companies/:id ─────────────────────────────────────────────────────

describe("GET /companies/:id", () => {
  it("returns 200 with company when caller is owner", async () => {
    // Two findFirst calls: requireCompanyAccess + route handler
    mockDb.query.companies.findFirst
      .mockResolvedValueOnce(TEST_COMPANY)   // requireCompanyAccess
      .mockResolvedValueOnce(TEST_COMPANY);  // route handler

    const res = await app.inject({ method: "GET", url: url(`/${TEST_COMPANY_ID}`) });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(TEST_COMPANY_ID);
  });

  it("returns 404 when company does not exist", async () => {
    mockDb.query.companies.findFirst.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: url("/nonexistent-id") });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 403 when company belongs to a different user", async () => {
    mockDb.query.companies.findFirst.mockResolvedValue({
      ...TEST_COMPANY,
      ownerId: "other-user-id",
    });

    const res = await app.inject({ method: "GET", url: url(`/${TEST_COMPANY_ID}`) });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });
});

// ── PATCH /companies/:id ───────────────────────────────────────────────────

describe("PATCH /companies/:id", () => {
  beforeEach(() => {
    mockDb.update.mockReturnValue(
      makeTestChain([{ ...TEST_COMPANY, tagline: "updated tagline" }])
    );
  });

  it("returns 200 on valid update with version", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_COMPANY_ID}`),
      ...json({ tagline: "updated tagline", version: 1 }),
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 422 when version field is missing", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_COMPANY_ID}`),
      ...json({ tagline: "updated tagline" }),
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 409 on stale version (optimistic lock conflict)", async () => {
    // update.returning() returns [] → OptimisticLockError
    mockDb.update.mockReturnValue(makeTestChain([]));

    const res = await app.inject({
      method: "PATCH",
      url: url(`/${TEST_COMPANY_ID}`),
      ...json({ tagline: "updated", version: 999 }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("OPTIMISTIC_LOCK");
  });
});

// ── DELETE /companies/:id ──────────────────────────────────────────────────

describe("DELETE /companies/:id", () => {
  it("returns 204 on successful soft delete", async () => {
    // DELETE awaits update chain without .returning() — chain is thenable
    mockDb.update.mockReturnValue(makeTestChain());

    const res = await app.inject({
      method: "DELETE",
      url: url(`/${TEST_COMPANY_ID}`),
    });

    expect(res.statusCode).toBe(204);
  });

  it("returns 404 when company does not exist", async () => {
    mockDb.query.companies.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "DELETE",
      url: url("/nonexistent-id"),
    });

    expect(res.statusCode).toBe(404);
  });
});
