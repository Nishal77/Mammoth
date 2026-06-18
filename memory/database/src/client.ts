import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

if (!process.env["DATABASE_URL"]) {
  throw new Error("DATABASE_URL environment variable is required");
}

const queryClient = postgres(process.env["DATABASE_URL"], {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema, logger: false });

export type Database = typeof db;
