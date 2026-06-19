import { execa } from "execa";
import path from "node:path";
import { readConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";

type ComposeService = "postgres" | "redis" | "qdrant" | "minio" | "all";

function getComposePath(): string {
  const config = readConfig();
  return path.join(config.projectRoot, "infrastructure", "docker", "docker-compose.dev.yml");
}

async function detectDockerCompose(): Promise<string[]> {
  try {
    await execa("docker", ["compose", "version"], { stdio: "pipe" });
    return ["docker", "compose"];
  } catch {
    // docker compose v1 fallback
    try {
      await execa("docker-compose", ["version"], { stdio: "pipe" });
      return ["docker-compose"];
    } catch {
      throw new Error("Docker Compose not found. Install Docker Desktop or docker-compose.");
    }
  }
}

async function runCompose(args: string[], inherit = false): Promise<void> {
  const composeBin = await detectDockerCompose();
  const composePath = getComposePath();
  const fullArgs = [...composeBin.slice(1), "-f", composePath, ...args];

  await execa(composeBin[0]!, fullArgs, {
    stdio: inherit ? "inherit" : "pipe",
  });
}

export async function checkDockerRunning(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function startServices(): Promise<void> {
  await runCompose(["up", "-d", "--remove-orphans"], false);
}

export async function stopServices(): Promise<void> {
  await runCompose(["down"], false);
}

export async function restartServices(): Promise<void> {
  await runCompose(["restart"], false);
}

export async function pullImages(): Promise<void> {
  await runCompose(["pull"], true);
}

export type ServiceStatus = {
  name: string;
  status: "running" | "stopped" | "restarting" | "unknown";
  health: "healthy" | "unhealthy" | "starting" | "none";
};

export async function getServiceStatuses(): Promise<ServiceStatus[]> {
  const composeBin = await detectDockerCompose();
  const composePath = getComposePath();
  const fullArgs = [...composeBin.slice(1), "-f", composePath, "ps", "--format", "json"];

  try {
    const result = await execa(composeBin[0]!, fullArgs, { stdio: "pipe" });
    const lines = result.stdout.trim().split("\n").filter(Boolean);

    return lines.map((line) => {
      try {
        const parsed = JSON.parse(line) as {
          Name: string;
          State: string;
          Health: string;
        };
        return {
          name: parsed.Name.replace("mammoth_", ""),
          status: normalizeState(parsed.State),
          health: normalizeHealth(parsed.Health),
        };
      } catch {
        return { name: "unknown", status: "unknown" as const, health: "none" as const };
      }
    });
  } catch {
    logger.warn("Could not read container statuses — are services started?");
    return [];
  }
}

export async function tailLogs(service: ComposeService, follow: boolean): Promise<void> {
  const args = service === "all"
    ? ["logs", follow ? "-f" : "--no-follow", "--tail=50"]
    : ["logs", follow ? "-f" : "--no-follow", "--tail=50", `mammoth_${service}`];

  await runCompose(args, true);
}

function normalizeState(state: string): ServiceStatus["status"] {
  if (state === "running") return "running";
  if (state === "restarting") return "restarting";
  if (state === "exited" || state === "stopped") return "stopped";
  return "unknown";
}

function normalizeHealth(health: string): ServiceStatus["health"] {
  if (health === "healthy") return "healthy";
  if (health === "unhealthy") return "unhealthy";
  if (health === "starting") return "starting";
  return "none";
}
