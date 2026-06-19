import { execa } from "execa";
import fs from "node:fs";
import chalk from "chalk";
import { getMammothDir, readConfig, readEnvFile } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { checkDockerRunning, getComposePath } from "../docker/compose-runner.js";
import { apiClient } from "../api/client.js";

type CheckResult = { label: string; ok: boolean; detail: string };

async function checkNode(): Promise<CheckResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0] ?? "0", 10);
  return { label: "Node.js >= 20", ok: major >= 20, detail: version };
}

async function checkDocker(): Promise<CheckResult> {
  try {
    const result = await execa("docker", ["--version"], { stdio: "pipe" });
    return { label: "Docker installed", ok: true, detail: result.stdout.trim() };
  } catch {
    return {
      label: "Docker installed",
      ok: false,
      detail: "not found — install from https://mammoth.run/docker",
    };
  }
}

async function checkDockerDaemon(): Promise<CheckResult> {
  const running = await checkDockerRunning();
  return {
    label: "Docker daemon running",
    ok: running,
    detail: running ? "online" : "offline — open Docker Desktop / OrbStack",
  };
}

async function checkMammothDir(): Promise<CheckResult> {
  const dir = getMammothDir();
  const ok = fs.existsSync(dir);
  return {
    label: "~/.mammoth directory",
    ok,
    detail: ok ? dir : "not found — run: mammoth init",
  };
}

async function checkComposeFile(): Promise<CheckResult> {
  const composePath = getComposePath();
  const ok = fs.existsSync(composePath);
  return {
    label: "docker-compose.yml",
    ok,
    detail: ok ? composePath : "not found — run: mammoth init --local",
  };
}

async function checkEnvFile(): Promise<CheckResult> {
  const envPath = `${getMammothDir()}/.env`;
  const ok = fs.existsSync(envPath);
  return {
    label: "API keys configured",
    ok,
    detail: ok ? "~/.mammoth/.env found" : "not found — run: mammoth init",
  };
}

async function checkCloudConnectivity(): Promise<CheckResult[]> {
  const env = readEnvFile();
  const results: CheckResult[] = [];

  // Neon Postgres
  const dbUrl = env["DATABASE_URL"] ?? "";
  if (dbUrl && !dbUrl.includes("localhost")) {
    try {
      const parsed = new URL(dbUrl);
      const response = await fetch(`https://${parsed.hostname}`, {
        signal: AbortSignal.timeout(5000),
        method: "HEAD",
      });
      results.push({
        label: "Neon Postgres reachable",
        ok: response.status < 500,
        detail: parsed.hostname,
      });
    } catch {
      results.push({
        label: "Neon Postgres reachable",
        ok: false,
        detail: "could not connect — check DATABASE_URL in ~/.mammoth/.env",
      });
    }
  }

  // Upstash Redis (rediss:// URL)
  const redisUrl = env["REDIS_URL"] ?? "";
  if (redisUrl && redisUrl.startsWith("rediss://")) {
    try {
      const parsed = new URL(redisUrl);
      const response = await fetch(`https://${parsed.hostname}`, {
        signal: AbortSignal.timeout(5000),
        method: "HEAD",
      });
      results.push({
        label: "Upstash Redis reachable",
        ok: response.status < 500,
        detail: parsed.hostname,
      });
    } catch {
      results.push({
        label: "Upstash Redis reachable",
        ok: false,
        detail: "could not connect — check REDIS_URL in ~/.mammoth/.env",
      });
    }
  }

  return results;
}

async function checkApiReachable(): Promise<CheckResult> {
  try {
    await apiClient.health();
    return { label: "API reachable", ok: true, detail: "http://localhost:4000" };
  } catch {
    return {
      label: "API reachable",
      ok: false,
      detail: "not responding — start it: pnpm --filter @mammoth/api dev",
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

  const config = readConfig();
  const isCloud = config.mode === "cloud";

  console.log();
  console.log(
    chalk.dim(`  Mode: ${isCloud ? "cloud (Neon + Upstash)" : config.mode === "local" ? "local (Docker)" : "not configured"}`)
  );
  console.log();

  let checks: CheckResult[];

  if (isCloud) {
    const cloudChecks = await checkCloudConnectivity();
    checks = await Promise.all([
      checkNode(),
      checkMammothDir(),
      checkEnvFile(),
      checkApiReachable(),
    ]);
    checks.push(...cloudChecks);
  } else {
    checks = await Promise.all([
      checkNode(),
      checkDocker(),
      checkDockerDaemon(),
      checkMammothDir(),
      checkComposeFile(),
      checkEnvFile(),
      checkApiReachable(),
    ]);
  }

  for (const check of checks) printCheck(check);

  logger.blank();

  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    logger.success("All checks passed.");
  } else {
    logger.warn(`${failed.length} check(s) failed. Fix issues above then retry.`);
    process.exit(1);
  }
}
