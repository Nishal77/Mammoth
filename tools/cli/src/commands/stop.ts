import ora from "ora";
import { logger } from "../lib/logger.js";
import { stopServices, checkDockerRunning } from "../docker/compose-runner.js";

export async function runStop(): Promise<void> {
  const dockerOk = await checkDockerRunning();
  if (!dockerOk) {
    logger.warn("Docker is not running — nothing to stop.");
    return;
  }

  const spinner = ora("Stopping all services").start();
  try {
    await stopServices();
    spinner.succeed("All services stopped");
  } catch (err) {
    spinner.fail("Stop failed");
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
