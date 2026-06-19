import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ── Mocks ──────────────────────────────────────────────────────────────────
// test-app.ts imports all routes, which transitively import auth.ts.
// Mock the entire auth module to prevent better-auth from connecting to a DB.
vi.mock("../../lib/auth.ts", () => ({
  auth: {
    api: { getSession: vi.fn().mockResolvedValue(null) },
  },
}));

// All routes also import @mammoth/memory-database.
// Mock it to prevent postgres connection attempts.
vi.mock("@mammoth/memory-database", () => ({
  db: {
    query: {
      companies: { findFirst: vi.fn(), findMany: vi.fn() },
      companyGoals: { findFirst: vi.fn(), findMany: vi.fn() },
      approvals: { findFirst: vi.fn(), findMany: vi.fn() },
      companyMemory: { findFirst: vi.fn(), findMany: vi.fn() },
      departments: { findFirst: vi.fn(), findMany: vi.fn() },
      departmentTasks: { findFirst: vi.fn(), findMany: vi.fn() },
      briefings: { findFirst: vi.fn(), findMany: vi.fn() },
      trustScores: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
  companies: {},
  departments: {},
  companyGoals: {},
  approvals: {},
  companyMemory: {},
  departmentTasks: {},
  trustScores: {},
  briefings: {},
  checkAndPromoteTrustScore: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ op: "eq", a, b })),
  and: vi.fn((...args) => ({ op: "and", args })),
  isNull: vi.fn((a) => ({ op: "isNull", a })),
  desc: vi.fn((a) => ({ op: "desc", a })),
  asc: vi.fn((a) => ({ op: "asc", a })),
  lt: vi.fn((a, b) => ({ op: "lt", a, b })),
  ilike: vi.fn((a, b) => ({ op: "ilike", a, b })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

// ── App setup ──────────────────────────────────────────────────────────────
import { vi } from "vitest";
import { buildTestApp } from "../setup/test-app.ts";

let app: FastifyInstance;

beforeAll(async () => { app = await buildTestApp(); });
afterAll(async () => { await app.close(); });

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("includes a numeric timestamp", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(typeof res.json().ts).toBe("number");
  });

  it("includes circuitBreakers field", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toHaveProperty("circuitBreakers");
  });
});
