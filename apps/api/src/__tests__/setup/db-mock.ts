import { vi } from "vitest";

/**
 * Creates a Drizzle-compatible chainable mock.
 *
 * The chain is thenable (can be awaited at any point in the chain) AND supports
 * `.returning()` for mutations that select their result back.
 *
 * Design constraint: Drizzle's fluent API allows callers to either:
 *   await db.update().set().where()               ← no .returning()
 *   await db.update().set().where().returning()   ← with .returning()
 *
 * Both work because:
 *   - The chain itself has a `.then()` method (resolves with resolveValue)
 *   - `.returning()` is a separate vi.fn() that callers can override
 */
function makeChain(resolveValue: unknown = undefined) {
  const chain: Record<string, unknown> & {
    returning: ReturnType<typeof vi.fn>;
  } = {
    values: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn().mockResolvedValue(Array.isArray(resolveValue) ? resolveValue : []),
    onConflictDoUpdate: vi.fn(),
    // Thenable — lets callers await the chain without calling .returning()
    then(
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown
    ) {
      return Promise.resolve(resolveValue).then(onFulfilled, onRejected);
    },
    catch(onRejected: (e: unknown) => unknown) {
      return Promise.resolve(resolveValue).catch(onRejected);
    },
  };

  // Every intermediate method returns the same chain for fluent chaining
  (chain.values as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.set as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.where as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.onConflictDoUpdate as ReturnType<typeof vi.fn>).mockReturnValue(chain);

  return chain;
}

/**
 * Builds a full DB mock that covers all operations used across API routes.
 * Query methods default to returning null / [] — override per test as needed.
 *
 * Usage in a test file:
 *   const mockDb = buildDbMock();
 *   vi.mock("@mammoth/memory-database", () => ({ db: mockDb, companies: {}, ... }));
 *   // Then in tests:
 *   mockDb.query.companies.findFirst.mockResolvedValue(TEST_COMPANY);
 */
/**
 * Creates a standalone Drizzle chain with a specific resolved value.
 * Export for test files that need to override insert/update return values per test.
 *
 * Usage:
 *   const chain = makeTestChain([TEST_COMPANY]);
 *   mockDb.insert.mockReturnValue(chain);
 */
export function makeTestChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> & {
    returning: ReturnType<typeof vi.fn>;
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => Promise<unknown>;
  } = {
    values: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn().mockResolvedValue(rows),
    onConflictDoUpdate: vi.fn(),
    then(onFulfilled, onRejected) {
      return Promise.resolve(undefined).then(onFulfilled, onRejected);
    },
  };
  (chain.values as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.set as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.where as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.onConflictDoUpdate as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

export function buildDbMock() {
  const mockDb = {
    query: {
      companies:       { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      companyGoals:    { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      approvals:       { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      companyMemory:   { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      departments:     { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      departmentTasks: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      taskRuns:        { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      trustScores:     { findFirst: vi.fn().mockResolvedValue(null) },
      metricsDaily:    { findFirst: vi.fn().mockResolvedValue(null) },
      briefings:       { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: vi.fn().mockReturnValue(makeChain([])),
    update: vi.fn().mockReturnValue(makeChain(undefined)),
    delete: vi.fn().mockReturnValue(makeChain(undefined)),
    transaction: vi.fn().mockImplementation(
      async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb)
    ),
  };

  return mockDb;
}

export type DbMock = ReturnType<typeof buildDbMock>;
