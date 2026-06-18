import pino from "pino";

/**
 * Standard context fields attached to every log line.
 * All fields are optional — include whatever is available at the call site.
 */
export type LogContext = {
  companyId?: string;
  agentRunId?: string;
  taskId?: string;
  departmentId?: string;
  actionType?: string;
  /** Any extra fields specific to the call site. */
  [key: string]: string | number | boolean | undefined;
};

// One root logger for the whole process.
// Child loggers inherit the transport and level.
const rootLogger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  ...(process.env["NODE_ENV"] !== "production"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
  // Always include timestamp in ISO format so log aggregators can sort.
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Creates a child logger pre-bound with a service name.
 * Use one per service at startup, then call .withContext() per request/job.
 *
 * @param serviceName - e.g. "api", "agent-worker", "orchestrator"
 */
export function createLogger(serviceName: string): ServiceLogger {
  return new ServiceLogger(rootLogger.child({ service: serviceName }));
}

/**
 * Thin wrapper around a pino child logger.
 * Exposes info/warn/error with typed context instead of raw pino args.
 */
export class ServiceLogger {
  private readonly pinoLogger: pino.Logger;

  constructor(pinoLogger: pino.Logger) {
    this.pinoLogger = pinoLogger;
  }

  /**
   * Returns a new logger with context fields pre-bound.
   * The original logger is unchanged.
   *
   * Usage:
   *   const jobLog = logger.withContext({ companyId, agentRunId });
   *   jobLog.info("job started");
   */
  withContext(context: LogContext): ServiceLogger {
    return new ServiceLogger(this.pinoLogger.child(context));
  }

  info(message: string, context: LogContext = {}): void {
    this.pinoLogger.info(context, message);
  }

  warn(message: string, context: LogContext = {}): void {
    this.pinoLogger.warn(context, message);
  }

  error(message: string, context: LogContext = {}): void {
    this.pinoLogger.error(context, message);
  }

  /**
   * Logs an Error object. Includes stack trace in the log line.
   * In production the stack ends up in your log aggregator for search.
   */
  errorWithStack(message: string, error: Error, context: LogContext = {}): void {
    this.pinoLogger.error(
      { ...context, err: { message: error.message, stack: error.stack } },
      message
    );
  }

  debug(message: string, context: LogContext = {}): void {
    this.pinoLogger.debug(context, message);
  }
}
