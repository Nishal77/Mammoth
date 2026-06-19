import chalk from "chalk";
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

export async function runStatus(): Promise<void> {
  logger.header("MAMMOTH Status");

  // Docker services
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
