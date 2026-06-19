import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { readConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { checkDockerRunning } from "../docker/compose-runner.js";
import { apiClient } from "../api/client.js";

type CheckResult = { label: string; ok: boolean; detail: string };

async function checkNode(): Promise<CheckResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0] ?? "0", 10);
  return {
    label: "Node.js >= 20",
    ok: major >= 20,
    detail: version,
  };
}

async function checkDocker(): Promise<CheckResult> {
  try {
    const result = await execa("docker", ["--version"], { stdio: "pipe" });
    return { label: "Docker installed", ok: true, detail: result.stdout.trim() };
  } catch {
    return { label: "Docker installed", ok: false, detail: "not found — install Docker Desktop" };
  }
}

async function checkDockerDaemon(): Promise<CheckResult> {
  const running = await checkDockerRunning();
  return {
    label: "Docker daemon running",
    ok: running,
    detail: running ? "online" : "offline — start Docker Desktop",
  };
}

async function checkProjectRoot(): Promise<CheckResult> {
  const config = readConfig();
  const composePath = path.join(config.projectRoot, "infrastructure", "docker", "docker-compose.dev.yml");
  const ok = fs.existsSync(composePath);
  return {
    label: "Project root valid",
    ok,
    detail: ok ? config.projectRoot : `docker-compose.dev.yml not found at ${composePath}`,
  };
}

async function checkEnvFile(): Promise<CheckResult> {
  const config = readConfig();
  const envPath = config.envPath ?? path.join(config.projectRoot, ".env.local");
  const ok = fs.existsSync(envPath);
  return {
    label: ".env.local exists",
    ok,
    detail: ok ? envPath : `not found — run: cp .env.example .env.local`,
  };
}

async function checkApiReachable(): Promise<CheckResult> {
  try {
    await apiClient.health();
    return { label: "API reachable", ok: true, detail: "http://localhost:4000" };
  } catch {
    return {
      label: "API reachable",
      ok: false,
      detail: "localhost:4000 not responding — run: mammoth start",
    };
  }
}

function printCheck(check: CheckResult): void {
  const icon = check.ok ? chalk.green("✓") : chalk.red("✗");
  const label = chalk.white(check.label.padEnd(30));
  const detail = check.ok ? chalk.dim(check.detail) : chalk.yellow(check.detail);
  console.log(`  ${icon}  ${label} ${detail}`);
}

export async function runDoctor(): Promise<void> {
  logger.header("MAMMOTH Doctor");

  const checks = await Promise.all([
    checkNode(),
    checkDocker(),
    checkDockerDaemon(),
    checkProjectRoot(),
    checkEnvFile(),
    checkApiReachable(),
  ]);

  for (const check of checks) {
    printCheck(check);
  }

  logger.blank();

  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    logger.success("All checks passed. System ready.");
  } else {
    logger.warn(`${failed.length} check(s) failed. Fix issues above then retry.`);
    process.exit(1);
  }
}
