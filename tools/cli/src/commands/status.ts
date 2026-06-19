import chalk from "chalk";
import { readConfig, readEnvFile } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { getServiceStatuses } from "../docker/compose-runner.js";
import { apiClient } from "../api/client.js";
import { getAuthState } from "../auth/token-store.js";

function colorStatus(status: string): string {
  if (status === "running") return chalk.green(status);
  if (status === "stopped") return chalk.red(status);
  if (status === "restarting") return chalk.yellow(status);
  return chalk.dim(status);
}

function colorHealth(health: string): string {
  if (health === "healthy") return chalk.green(health);
  if (health === "unhealthy") return chalk.red(health);
  if (health === "starting") return chalk.yellow(health);
  return chalk.dim("");
}

async function showCloudStatus(): Promise<void> {
  const env = readEnvFile();

  console.log(chalk.bold("\n  Cloud Infrastructure\n"));

  const dbUrl = env["DATABASE_URL"] ?? "";
  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);
      const isNeon = parsed.hostname.includes("neon.tech");
      console.log(
        `    ${"Postgres".padEnd(18)} ${chalk.green("configured")}  ${chalk.dim(isNeon ? "Neon — " + parsed.hostname : parsed.hostname)}`
      );
    } catch {
      console.log(`    ${"Postgres".padEnd(18)} ${chalk.yellow("invalid URL")}`);
    }
  } else {
    console.log(`    ${"Postgres".padEnd(18)} ${chalk.red("not configured")}  — run: mammoth init --cloud`);
  }

  const redisUrl = env["REDIS_URL"] ?? "";
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      const isUpstash = parsed.hostname.includes("upstash.io");
      console.log(
        `    ${"Redis".padEnd(18)} ${chalk.green("configured")}  ${chalk.dim(isUpstash ? "Upstash — " + parsed.hostname : parsed.hostname)}`
      );
    } catch {
      console.log(`    ${"Redis".padEnd(18)} ${chalk.yellow("invalid URL")}`);
    }
  } else {
    console.log(`    ${"Redis".padEnd(18)} ${chalk.red("not configured")}  — run: mammoth init --cloud`);
  }

  const qdrantUrl = env["QDRANT_URL"] ?? "";
  if (qdrantUrl && qdrantUrl !== "http://localhost:6333") {
    console.log(`    ${"Qdrant".padEnd(18)} ${chalk.green("configured")}  ${chalk.dim(qdrantUrl)}`);
  } else {
    console.log(`    ${"Qdrant".padEnd(18)} ${chalk.dim("not configured (optional)")}`);
  }
}

async function showLocalStatus(): Promise<void> {
  const serviceStatuses = await getServiceStatuses();

  if (serviceStatuses.length === 0) {
    logger.warn("No containers running. Start with: mammoth start");
    return;
  }

  console.log(chalk.bold("\n  Infrastructure\n"));
  for (const svc of serviceStatuses) {
    const health = svc.health !== "none" ? `  ${colorHealth(svc.health)}` : "";
    console.log(
      `    ${svc.name.padEnd(18)} ${colorStatus(svc.status)}${health}`
    );
  }
}

export async function runStatus(): Promise<void> {
  logger.header("MAMMOTH Status");

  const config = readConfig();
  const isCloud = config.mode === "cloud";

  console.log(chalk.dim(`\n  Mode: ${isCloud ? "cloud" : config.mode === "local" ? "local" : "not configured"}`));

  if (isCloud) {
    await showCloudStatus();
  } else {
    await showLocalStatus();
  }

  // Auth state
  const authState = getAuthState();
  console.log(chalk.bold("\n  Authentication\n"));
  if (authState.isAuthenticated) {
    console.log(`    Logged in as  ${chalk.cyan(authState.email)}`);
  } else {
    console.log(`    ${chalk.yellow("Not authenticated")}  — run: mammoth auth login`);
  }

  // Companies + pending approvals
  if (authState.isAuthenticated) {
    try {
      const companies = await apiClient.listCompanies();
      console.log(chalk.bold("\n  Companies\n"));

      if (companies.length === 0) {
        console.log(`    ${chalk.dim("No companies — visit dashboard to create one")}`);
      } else {
        for (const company of companies) {
          const approvals = await apiClient.listPendingApprovals(company.id);
          const badge =
            approvals.length > 0
              ? chalk.yellow(` (${approvals.length} pending approval${approvals.length > 1 ? "s" : ""})`)
              : "";
          console.log(`    ${chalk.white(company.name)}${badge}`);
        }
      }
    } catch {
      console.log(`    ${chalk.dim("API not reachable")}`);
    }
  }

  logger.blank();
}
