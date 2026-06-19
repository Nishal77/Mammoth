import ora from "ora";
import { execa } from "execa";
import { logger } from "../lib/logger.js";
import { readConfig } from "../lib/config.js";
import { pullImages, stopServices, startServices } from "../docker/compose-runner.js";

export async function runUpgrade(): Promise<void> {
  logger.header("MAMMOTH Upgrade");

  const config = readConfig();

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

  const migrateSpinner = ora("Running migrations").start();
  try {
    await execa("pnpm", ["db:migrate"], {
      cwd: config.projectRoot,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    });
    migrateSpinner.succeed("Migrations complete");
  } catch {
    migrateSpinner.fail("Migrations failed — check DATABASE_URL in .env.local");
    process.exit(1);
  }

  const startSpinner = ora("Restarting services").start();
  await startServices();
  startSpinner.succeed("Services restarted");

  logger.blank();
  logger.success("Upgrade complete.");
}
