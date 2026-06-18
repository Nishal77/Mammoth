import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type * as schema from "./schema/index.ts";

type DB = PostgresJsDatabase<typeof schema>;

/**
 * Sets the PostgreSQL session variables that RLS policies read.
 * Call this at the start of every agent or API transaction that touches
 * company-scoped tables.
 *
 * Must be called inside a transaction so the SET LOCAL is scoped to
 * that transaction only — it resets automatically on COMMIT/ROLLBACK.
 */
export async function setRlsContext(
  tx: PgTransaction<
    Record<string, never>,
    ExtractTablesWithRelations<typeof schema>
  >,
  context: { companyId: string; userId: string }
): Promise<void> {
  await tx.execute(
    sql`SELECT set_config('app.current_company_id', ${context.companyId}, true),
               set_config('app.current_user_id',    ${context.userId},    true)`
  );
}

/**
 * Convenience wrapper: opens a transaction, sets RLS context, runs your
 * callback, and returns the result. The RLS context is transaction-local.
 */
export async function withRls<T>(
  db: DB,
  context: { companyId: string; userId: string },
  callback: (
    tx: Parameters<Parameters<DB["transaction"]>[0]>[0]
  ) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await setRlsContext(
      tx as Parameters<typeof setRlsContext>[0],
      context
    );
    return callback(tx);
  });
}
