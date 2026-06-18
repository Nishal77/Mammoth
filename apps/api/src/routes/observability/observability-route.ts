import type { FastifyInstance } from "fastify";
import { circuitBreakerRegistry } from "@mammoth/observability/circuit-breaker";
import { getDlqDepth, getDlqJobs, replayDlqJob } from "@mammoth/observability/dead-letter-queue";
import { z } from "zod";

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

const ReplayBodySchema = z.object({
  originalJobId: z.string().min(1),
});

/**
 * Internal observability endpoints.
 * These expose circuit breaker states and the dead-letter queue.
 * In production, protect these with an internal-network-only firewall rule.
 */
export async function observabilityRoute(app: FastifyInstance): Promise<void> {
  /**
   * GET /internal/circuit-breakers
   * Returns the current state of all registered circuit breakers.
   * Any OPEN state means an external service is currently failing.
   */
  app.get("/circuit-breakers", async (_request, reply) => {
    const states = circuitBreakerRegistry.getAllStates();
    const hasOpenBreaker = Object.values(states).some((s) => s === "OPEN");

    return reply.send({
      status: hasOpenBreaker ? "degraded" : "healthy",
      breakers: states,
    });
  });

  /**
   * GET /internal/dlq
   * Returns the number of jobs in the dead-letter queue.
   * DLQ depth > 0 should trigger an alert — jobs are waiting for replay.
   */
  app.get("/dlq", async (_request, reply) => {
    const depth = await getDlqDepth(REDIS_CONNECTION);
    return reply.send({ depth });
  });

  /**
   * GET /internal/dlq/jobs
   * Returns all jobs in the dead-letter queue with their error details.
   * Use this to understand WHY jobs are failing before replaying them.
   */
  app.get("/dlq/jobs", async (_request, reply) => {
    const jobs = await getDlqJobs(REDIS_CONNECTION);
    return reply.send({ jobs });
  });

  /**
   * POST /internal/dlq/replay
   * Re-queues a failed job from the DLQ back to its original source queue.
   * Use after fixing the root cause of the failure.
   *
   * Body: { originalJobId: string }
   */
  app.post("/dlq/replay", async (request, reply) => {
    const parsed = ReplayBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "originalJobId is required",
        code: "INVALID_BODY",
      });
    }

    const replayed = await replayDlqJob(REDIS_CONNECTION, parsed.data.originalJobId);
    if (!replayed) {
      return reply.status(404).send({
        error: `Job ${parsed.data.originalJobId} not found in DLQ`,
        code: "JOB_NOT_FOUND",
      });
    }

    return reply.send({ replayed: true, originalJobId: parsed.data.originalJobId });
  });
}
