import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import {
  trace,
  context,
  SpanStatusCode,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

export type OtelConfig = {
  /** Service name shown in your tracing backend (e.g. Jaeger, Honeycomb, Datadog). */
  serviceName: string;
  /** Service version — use your git SHA or semver. */
  serviceVersion: string;
  /**
   * OTLP collector endpoint.
   * e.g. "http://localhost:4318/v1/traces" for a local Jaeger instance.
   * Leave undefined to disable exporting (traces still happen, just not sent).
   */
  collectorUrl: string | undefined;
};

let sdk: NodeSDK | undefined;

/**
 * Starts the OpenTelemetry SDK.
 * Call once at process startup, before any route/job handlers.
 * Auto-instruments: http, express/fastify, pg, redis, etc.
 * No-op if collectorUrl is missing.
 */
export function initTracing(config: OtelConfig): void {
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: config.collectorUrl
      ? new OTLPTraceExporter({ url: config.collectorUrl })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem instrumentation is too noisy in practice.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
}

/**
 * Shuts down the tracing SDK gracefully.
 * Call in your process shutdown handler to flush pending spans.
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}

/**
 * Returns the tracer for the given name (usually your module name).
 * Use this to create spans inside your business logic.
 */
export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

/**
 * Wraps an async function in an OpenTelemetry span.
 * The span is automatically ended on success or error.
 * Error is re-thrown after recording it on the span.
 *
 * Usage:
 *   const result = await withSpan("syncHubspot", { companyId }, async () => {
 *     return syncHubspot(companyId);
 *   });
 *
 * @param spanName    - Name shown in your tracing UI
 * @param attributes  - Key/value pairs attached to the span
 * @param fn          - The async work to trace
 */
export async function withSpan<T>(
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer("mammoth");
  return tracer.startActiveSpan(spanName, async (span) => {
    // Attach all attributes to the span for filtering in your tracing UI.
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      // Record the error on the span so it shows as failed in the UI.
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export { context as otelContext, SpanStatusCode };
