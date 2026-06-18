import type { Config } from "drizzle-kit";

if (!process.env["DATABASE_URL"]) {
  throw new Error("DATABASE_URL environment variable is required");
}

export default {
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"],
  },
  verbose: true,
  strict: true,
} satisfies Config;
