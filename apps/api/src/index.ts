import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyCookie from "@fastify/cookie";
import { registerErrorHandler } from "./plugins/error-handler.ts";
import { registerRateLimit } from "./plugins/rate-limit.ts";
import { companiesRoute } from "./routes/companies/companies-route.ts";
import { goalsRoute } from "./routes/goals/goals-route.ts";
import { approvalsRoute } from "./routes/approvals/approvals-route.ts";
import { memoryRoute } from "./routes/memory/memory-route.ts";
import { departmentsRoute } from "./routes/departments/departments-route.ts";
import { metricsRoute } from "./routes/metrics/metrics-route.ts";
import { onboardingRoute } from "./routes/onboarding/onboarding-route.ts";
import { notificationConnectRoute } from "./routes/users/notification-connect-route.ts";
import { stripeWebhookRoute } from "./routes/webhooks/stripe-webhook-route.ts";
import { integrationsRoute } from "./routes/integrations/integrations-route.ts";
import { billingRoute } from "./routes/billing/billing-route.ts";
import { auth } from "./lib/auth.ts";
import { initSocketServer } from "./lib/socket.ts";
import { toNodeHandler } from "better-auth/node";

const PORT = Number(process.env["PORT"] ?? 4000);
const HOST = process.env["HOST"] ?? "0.0.0.0";

const app = Fastify({
  logger: {
    level: process.env["LOG_LEVEL"] ?? "info",
    transport:
      process.env["NODE_ENV"] !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  trustProxy: true,
});

// Security headers
await app.register(fastifyHelmet, {
  contentSecurityPolicy: false, // Managed at edge/CDN level
});

// CORS
await app.register(fastifyCors, {
  origin: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
});

// Cookie support for Better Auth
await app.register(fastifyCookie);

// Rate limiting (backed by Redis)
await registerRateLimit(app);

// Centralised error handler
registerErrorHandler(app);

// Better Auth handles all /api/auth/* routes
app.all("/api/auth/*", async (request, reply) => {
  const handler = toNodeHandler(auth);
  return handler(request.raw, reply.raw);
});

// Health check
app.get("/health", async (_request, reply) => {
  return reply.send({ status: "ok", ts: Date.now() });
});

// Company-scoped routes
await app.register(companiesRoute, { prefix: "/api/v1/companies" });

await app.register(
  async (instance) => {
    await instance.register(goalsRoute, { prefix: "/" });
  },
  { prefix: "/api/v1/companies/:companyId/goals" }
);

await app.register(
  async (instance) => {
    await instance.register(approvalsRoute, { prefix: "/" });
  },
  { prefix: "/api/v1/companies/:companyId/approvals" }
);

await app.register(
  async (instance) => {
    await instance.register(memoryRoute, { prefix: "/" });
  },
  { prefix: "/api/v1/companies/:companyId/memory" }
);

await app.register(
  async (instance) => {
    await instance.register(departmentsRoute, { prefix: "/" });
  },
  { prefix: "/api/v1/companies/:companyId/departments" }
);

await app.register(
  async (instance) => {
    await instance.register(metricsRoute, { prefix: "/" });
  },
  { prefix: "/api/v1/companies/:companyId/metrics" }
);

// Onboarding (unauthenticated start, auth on step/complete)
await app.register(onboardingRoute, { prefix: "/api/v1/onboarding" });

// User notification channel connect/disconnect
await app.register(notificationConnectRoute, {
  prefix: "/api/v1/users/me/notifications",
});

// Integrations (Stripe MRR, HubSpot, GitHub, Slack, Plausible)
await app.register(
  async (instance) => {
    await instance.register(integrationsRoute, { prefix: "/" });
  },
  { prefix: "/api/v1/companies/:companyId/integrations" }
);

// Stripe MRR webhook (one endpoint per company, identified by ?companyId=)
await app.register(stripeWebhookRoute, { prefix: "/api/v1/webhooks" });

// Billing (MAMMOTH subscriptions — checkout, portal, usage, billing webhook)
await app.register(billingRoute, { prefix: "/api/v1/billing" });

// Start server
const httpServer = await app.listen({ port: PORT, host: HOST });
initSocketServer(app.server);

app.log.info(`API listening on ${HOST}:${PORT}`);

// Graceful shutdown
const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`Received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
