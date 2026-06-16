import type { FastifyInstance } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { redis } from "../lib/redis.ts";

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
    redis,
    keyGenerator: (request) => {
      // Rate limit by authenticated user ID when available, else by IP
      return (request.user?.id ?? request.ip) as string;
    },
    errorResponseBuilder: (_request, context) => ({
      data: null,
      error: {
        message: `Too many requests. Retry after ${context.after}`,
        code: "RATE_LIMIT_EXCEEDED",
      },
    }),
  });
}
