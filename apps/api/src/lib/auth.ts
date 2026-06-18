import { betterAuth } from "better-auth";

if (!process.env["BETTER_AUTH_SECRET"]) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required");
}

export const auth = betterAuth({
  database: {
    // Better Auth manages its own session/account tables via the db connection
    provider: "pg",
    url: process.env["DATABASE_URL"],
  },
  secret: process.env["BETTER_AUTH_SECRET"],
  baseURL: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,      // update session every 24h if used
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minute cache
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  trustedOrigins: [
    process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
