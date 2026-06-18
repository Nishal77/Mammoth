// Observability must be initialised before any other imports so Sentry
// and OpenTelemetry auto-instrumentation can patch http/pg/redis early.
import { initSentry, flushSentry } from "@mammoth/observability/sentry";
import { initTracing, shutdownTracing } from "@mammoth/observability/tracing";
import { createLogger } from "@mammoth/observability/logger";

initSentry({
  dsn: process.env["SENTRY_DSN"],
  serviceName: "api",
  environment: process.env["NODE_ENV"] ?? "development",
});

initTracing({
  serviceName: "mammoth-api",
  serviceVersion: process.env["SERVICE_VERSION"] ?? "0.0.1",
  collectorUrl: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
});

const log = createLogger("api");

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
import { githubWebhookRoute } from "./routes/webhooks/github-webhook-route.ts";
import { integrationsRoute } from "./routes/integrations/integrations-route.ts";
import { billingRoute } from "./routes/billing/billing-route.ts";
import { auth } from "./lib/auth.ts";
import { initSocketServer } from "./lib/socket.ts";
import { toNodeHandler } from "better-auth/node";
import { circuitBreakerRegistry } from "@mammoth/observability/circuit-breaker";
import { observabilityRoute } from "./routes/observability/observability-route.ts";

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

// Health check — includes circuit breaker states so ops can see degraded integrations
app.get("/health", async (_request, reply) => {
  return reply.send({
    status: "ok",
    ts: Date.now(),
    circuitBreakers: circuitBreakerRegistry.getAllStates(),
  });
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
await app.register(stripeWebhookRoute, { prefix: "/api/v1/webhooks/stripe" });
await app.register(githubWebhookRoute, { prefix: "/api/v1/webhooks/github" });

// Billing (MAMMOTH subscriptions — checkout, portal, usage, billing webhook)
await app.register(billingRoute, { prefix: "/api/v1/billing" });

// Internal observability — circuit breaker states, DLQ inspection and replay
// Protect this prefix with a firewall rule in production (internal network only).
await app.register(observabilityRoute, { prefix: "/internal" });

// Start server
const httpServer = await app.listen({ port: PORT, host: HOST });
initSocketServer(app.server);

log.info("API started", { port: String(PORT), host: HOST });

// Graceful shutdown — flush Sentry events and OTel spans before exit
const shutdown = async (signal: string): Promise<void> => {
  log.info(`Received ${signal}, shutting down`);
  await Promise.all([app.close(), flushSentry(), shutdownTracing()]);
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
