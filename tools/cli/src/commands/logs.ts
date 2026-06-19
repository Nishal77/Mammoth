import { tailLogs } from "../docker/compose-runner.js";
import { logger } from "../lib/logger.js";

const VALID_SERVICES = ["postgres", "redis", "qdrant", "minio", "all"] as const;
type LogService = (typeof VALID_SERVICES)[number];

export async function runLogs(
  service: string | undefined,
  opts: { follow: boolean }
): Promise<void> {
  const target = (service ?? "all") as LogService;

  if (!VALID_SERVICES.includes(target)) {
    logger.error(`Unknown service "${service}". Valid: ${VALID_SERVICES.join(", ")}`);
    process.exit(1);
  }

  if (opts.follow) {
    logger.dim(`Tailing ${target} logs. Ctrl+C to stop.`);
  }

  try {
    await tailLogs(target, opts.follow);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
