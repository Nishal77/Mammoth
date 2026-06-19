import ora from "ora";
import { logger } from "../lib/logger.js";
import { pullImages, stopServices, startServices } from "../docker/compose-runner.js";

export async function runUpgrade(): Promise<void> {
  logger.header("MAMMOTH Upgrade");

  const stopSpinner = ora("Stopping services").start();
  await stopServices();
  stopSpinner.succeed("Services stopped");

  const pullSpinner = ora("Pulling latest images").start();
  try {
    await pullImages();
    pullSpinner.succeed("Images updated");
  } catch {
    pullSpinner.warn("Image pull had warnings");
  }

  const startSpinner = ora("Restarting services").start();
  await startServices();
  startSpinner.succeed("Services restarted");

  logger.blank();
  logger.success("Upgrade complete.");
  logger.dim("If you have the source code, run: pnpm db:migrate");
}
