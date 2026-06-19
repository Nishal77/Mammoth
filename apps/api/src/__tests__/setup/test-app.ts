import Fastify, { type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyCookie from "@fastify/cookie";
import { registerErrorHandler } from "../../plugins/error-handler.ts";
import { companiesRoute } from "../../routes/companies/companies-route.ts";
import { goalsRoute } from "../../routes/goals/goals-route.ts";
import { approvalsRoute } from "../../routes/approvals/approvals-route.ts";
import { memoryRoute } from "../../routes/memory/memory-route.ts";
import { departmentsRoute } from "../../routes/departments/departments-route.ts";

/**
 * Creates a minimal Fastify instance with all API routes registered.
 *
 * Does NOT start Sentry, tracing, or real Redis connections — those are
 * mocked at the test file level via vi.mock(). Call this once per test
 * file in a beforeAll block, then use app.inject() to make requests.
 *
 * Route params like :companyId in the prefix ARE captured by Fastify —
 * direct registration works the same as the production double-nested pattern.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyCookie);

  registerErrorHandler(app);

  // Health check — same as production
  app.get("/health", async (_request, reply) => {
    return reply.send({ status: "ok", ts: Date.now(), circuitBreakers: {} });
  });

  // Routes — direct registration with the same prefixes as production.
  // :companyId is captured from the prefix by Fastify and available as request.params.companyId.
  await app.register(companiesRoute, { prefix: "/api/v1/companies" });
  await app.register(goalsRoute, { prefix: "/api/v1/companies/:companyId/goals" });
  await app.register(approvalsRoute, { prefix: "/api/v1/companies/:companyId/approvals" });
  await app.register(memoryRoute, { prefix: "/api/v1/companies/:companyId/memory" });
  await app.register(departmentsRoute, { prefix: "/api/v1/companies/:companyId/departments" });

  await app.ready();
  return app;
}
