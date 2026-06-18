import { Redis } from "ioredis";
import { randomUUID } from "crypto";
import { createLogger } from "@mammoth/observability/logger";

const log = createLogger("cross-agent-channel");

const CHANNEL_PREFIX = "mammoth:agent-channel";
const REQUEST_TTL_SECONDS = 120;
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;

export type CrossAgentRequest = {
  requestId: string;
  companyId: string;
  fromDepartment: string;
  toDepartment: string;
  requestType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CrossAgentResponse = {
  requestId: string;
  respondingDepartment: string;
  result: Record<string, unknown>;
  error?: string | undefined;
};

function buildRedis(): Redis {
  return new Redis({
    host: process.env["REDIS_HOST"] ?? "localhost",
    port: Number(process.env["REDIS_PORT"] ?? 6379),
    password: process.env["REDIS_PASSWORD"] ?? undefined,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
}

/**
 * Cross-agent communication channel backed by Redis pub/sub + key expiry.
 *
 * Pattern:
 *   Sales agent needs competitor intel from Research:
 *   1. sales calls channel.publish(request)
 *   2. Research has channel.subscribe("research") listener
 *   3. Research calls channel.respond(requestId, result)
 *   4. Sales awaits channel.awaitResponse(requestId)
 *
 * Requests expire after 2 minutes — agents must not block indefinitely.
 * This enables real inter-department collaboration within a cycle without
 * coupling agent execution or requiring shared memory writes.
 */
export class CrossAgentChannel {
  private readonly publishRedis: InstanceType<typeof Redis>;
  private readonly subscribeRedis: InstanceType<typeof Redis>;

  constructor() {
    this.publishRedis = buildRedis();
    this.subscribeRedis = buildRedis();
  }

  /**
   * Publishes a request from one department to another.
   * Returns the requestId so the caller can await the response.
   */
  async publish(options: {
    companyId: string;
    fromDepartment: string;
    toDepartment: string;
    requestType: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const requestId = randomUUID();
    const request: CrossAgentRequest = {
      requestId,
      ...options,
      createdAt: new Date().toISOString(),
    };

    const channel = `${CHANNEL_PREFIX}:${options.companyId}:${options.toDepartment}`;
    const key = `${CHANNEL_PREFIX}:request:${requestId}`;

    const pipeline = this.publishRedis.pipeline();
    pipeline.setex(key, REQUEST_TTL_SECONDS, JSON.stringify(request));
    pipeline.publish(channel, JSON.stringify(request));
    await pipeline.exec();

    log.info("Cross-agent request published", {
      companyId: options.companyId,
      requestId,
      fromDepartment: options.fromDepartment,
      toDepartment: options.toDepartment,
      requestType: options.requestType,
    });

    return requestId;
  }

  /**
   * Publishes a response to a previous request.
   * Stores result in Redis + notifies the waiting caller via pub/sub.
   */
  async respond(requestId: string, result: CrossAgentResponse): Promise<void> {
    const responseKey = `${CHANNEL_PREFIX}:response:${requestId}`;
    const responseChannel = `${CHANNEL_PREFIX}:response-channel:${requestId}`;

    const pipeline = this.publishRedis.pipeline();
    pipeline.setex(responseKey, REQUEST_TTL_SECONDS, JSON.stringify(result));
    pipeline.publish(responseChannel, JSON.stringify(result));
    await pipeline.exec();
  }

  /**
   * Waits for a response to a published request.
   * Resolves when the responding agent calls respond(), or rejects on timeout.
   */
  async awaitResponse(
    requestId: string,
    timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS
  ): Promise<CrossAgentResponse> {
    const responseKey = `${CHANNEL_PREFIX}:response:${requestId}`;

    // Check if already answered (fast path — responding agent ran before us)
    const existing = await this.publishRedis.get(responseKey);
    if (existing) {
      return JSON.parse(existing) as CrossAgentResponse;
    }

    return new Promise((resolve, reject) => {
      const responseChannel = `${CHANNEL_PREFIX}:response-channel:${requestId}`;
      const timer = setTimeout(() => {
        void this.subscribeRedis.unsubscribe(responseChannel);
        reject(new Error(`Cross-agent response timeout after ${timeoutMs}ms for request ${requestId}`));
      }, timeoutMs);

      void this.subscribeRedis.subscribe(responseChannel).catch((err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      this.subscribeRedis.on("message", (channel: string, message: string) => {
        if (channel !== responseChannel) return;
        clearTimeout(timer);
        void this.subscribeRedis.unsubscribe(responseChannel);
        try {
          resolve(JSON.parse(message) as CrossAgentResponse);
        } catch {
          reject(new Error("Failed to parse cross-agent response"));
        }
      });
    });
  }

  /**
   * Subscribes a department to incoming cross-agent requests.
   * Returns an async iterator of requests — process in a background loop.
   *
   * @example
   * for await (const req of channel.subscribeRequests("research", companyId)) {
   *   const result = await handleRequest(req);
   *   await channel.respond(req.requestId, { requestId: req.requestId, respondingDepartment: "research", result });
   * }
   */
  async *subscribeRequests(
    department: string,
    companyId: string
  ): AsyncGenerator<CrossAgentRequest> {
    const channel = `${CHANNEL_PREFIX}:${companyId}:${department}`;
    const sub = new Redis({
      host: process.env["REDIS_HOST"] ?? "localhost",
      port: Number(process.env["REDIS_PORT"] ?? 6379),
      password: process.env["REDIS_PASSWORD"] ?? undefined,
      maxRetriesPerRequest: null,
    });

    await sub.subscribe(channel);

    const queue: CrossAgentRequest[] = [];
    let resolve: (() => void) | null = null;

    sub.on("message", (_channel: string, message: string) => {
      try {
        const req = JSON.parse(message) as CrossAgentRequest;
        queue.push(req);
        resolve?.();
        resolve = null;
      } catch {
        log.warn("Failed to parse cross-agent request", { channel });
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>((res) => { resolve = res; });
        }
      }
    } finally {
      await sub.unsubscribe(channel);
      sub.disconnect();
    }
  }

  async close(): Promise<void> {
    this.publishRedis.disconnect();
    this.subscribeRedis.disconnect();
  }
}

// Singleton for use across the dispatcher
export const crossAgentChannel = new CrossAgentChannel();
