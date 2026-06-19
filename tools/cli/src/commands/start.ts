import ora from "ora";
import { logger } from "../lib/logger.js";
import {
  checkDockerRunning,
  startServices,
  getServiceStatuses,
} from "../docker/compose-runner.js";

async function waitForHealthy(maxWait = 60_000): Promise<void> {
  const deadline = Date.now() + maxWait;
  const targets = ["postgres", "redis", "qdrant"];

  while (Date.now() < deadline) {
    const statuses = await getServiceStatuses();
    const allHealthy = targets.every((name) => {
      const svc = statuses.find((s) => s.name.includes(name));
      return svc?.health === "healthy" || svc?.status === "running";
    });
    if (allHealthy) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function runStart(): Promise<void> {
  const dockerOk = await checkDockerRunning();
  if (!dockerOk) {
    logger.error("Docker is not running. Start Docker Desktop first.");
    process.exit(1);
  }

  const startSpinner = ora("Starting infrastructure services").start();
  try {
    await startServices();
    startSpinner.text = "Waiting for services to be healthy";
    await waitForHealthy();
    startSpinner.succeed("All services running");
  } catch (err) {
    startSpinner.fail("Failed to start services");
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const statuses = await getServiceStatuses();
  logger.blank();
  logger.header("Service Status");
  for (const svc of statuses) {
    const icon = svc.status === "running" ? "+" : "-";
    const health = svc.health !== "none" ? ` [${svc.health}]` : "";
    console.log(`  ${icon}  ${svc.name.padEnd(15)} ${svc.status}${health}`);
  }
}
