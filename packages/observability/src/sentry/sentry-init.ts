import * as Sentry from "@sentry/node";

export type SentryConfig = {
  /** The Sentry DSN. Leave undefined to disable Sentry (e.g. in dev). */
  dsn: string | undefined;
  /** Service name shown in Sentry (e.g. "api", "agent-worker"). */
  serviceName: string;
  /** "production" | "staging" | "development" */
  environment: string;
  /** Sample rate 0–1. 1 = capture every trace. Lower in high-traffic prod. */
  tracesSampleRate?: number;
};

/**
 * Initialises Sentry for the calling service.
 * Call this ONCE at startup, before any other imports that might throw.
 * If DSN is missing, Sentry is a no-op — safe for local dev.
 */
export function initSentry(config: SentryConfig): void {
  if (!config.dsn) {
    // No DSN = Sentry disabled. All captureException / captureEvent calls
    // become no-ops automatically. Nothing to warn about.
    return;
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    tracesSampleRate: config.tracesSampleRate ?? 0.1,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.nodeContextIntegration(),
    ],
    // Add service name to every event so Sentry can filter by service.
    initialScope: {
      tags: { service: config.serviceName },
    },
  });
}

/**
 * Captures an error in Sentry with extra context attached.
 * Always safe to call — if Sentry is not initialised it is a no-op.
 *
 * @param error - The error to capture
 * @param context - Key/value pairs attached to the Sentry event
 */
export function captureError(
  error: Error,
  context: Record<string, string | number | boolean> = {}
): void {
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      scope.setTag(key, String(value));
    }
    Sentry.captureException(error);
  });
}

/**
 * Flushes pending Sentry events before process exit.
 * Call in the graceful shutdown handler. Waits up to 2 seconds.
 */
export async function flushSentry(): Promise<void> {
  await Sentry.flush(2000);
}
