export {
  initTracing,
  shutdownTracing,
  getTracer,
  withSpan,
  otelContext,
  SpanStatusCode,
} from "./otel-tracer.ts";
export type { OtelConfig } from "./otel-tracer.ts";
