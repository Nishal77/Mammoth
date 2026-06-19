import inquirer from "inquirer";
import fs from "node:fs";
import path from "node:path";
import ora from "ora";
import chalk from "chalk";
import { writeConfig, getMammothDir } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import {
  checkDockerRunning,
  pullImages,
  startServices,
  getServiceStatuses,
  ensureComposeFile,
} from "../docker/compose-runner.js";
import { apiClient } from "../api/client.js";
import { saveToken } from "../auth/token-store.js";

const ENV_FILE = path.join(getMammothDir(), ".env");

const REQUIRED_KEYS = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    hint: "Get it at console.anthropic.com",
    prefix: "sk-ant-",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API key",
    hint: "Used for embeddings — get it at platform.openai.com",
    prefix: "sk-",
  },
];

const OPTIONAL_KEYS = [
  { key: "EXA_API_KEY", label: "Exa API key", hint: "Web search for agents — exa.ai" },
  { key: "APOLLO_API_KEY", label: "Apollo API key", hint: "B2B lead database — apollo.io" },
  { key: "RESEND_API_KEY", label: "Resend API key", hint: "Email sending — resend.com" },
];

function writeEnvFile(values: Record<string, string>): void {
  const lines = Object.entries(values)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n", { mode: 0o600 });
}

async function waitForApi(apiUrl: string, maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

function printBanner(): void {
  console.clear();
  console.log(chalk.bold.white("\n  MAMMOTH Setup\n"));
  console.log(chalk.dim("  Sets up your AI company OS in 3 steps:"));
  console.log(chalk.dim("  1. Enter API keys"));
  console.log(chalk.dim("  2. Start infrastructure (Docker)"));
  console.log(chalk.dim("  3. Create your account\n"));
}

export async function runInit(): Promise<void> {
  printBanner();

  // Step 0: Docker check
  const dockerRunning = await checkDockerRunning();
  if (!dockerRunning) {
    logger.error("Docker is not running.");
    console.log(chalk.dim("\n  Get Docker Desktop: https://mammoth.run/docker"));
    console.log(chalk.dim("  Then run: mammoth init\n"));
    process.exit(1);
  }

  // Already set up?
  if (fs.existsSync(ENV_FILE)) {
    const { redo } = await inquirer.prompt<{ redo: boolean }>([
      {
        type: "confirm",
        name: "redo",
        message: "MAMMOTH is already configured. Re-run setup?",
        default: false,
      },
    ]);
    if (!redo) {
      const startSpinner = ora("Starting services").start();
      await startServices();
      startSpinner.succeed("Services running — MAMMOTH is ready");
      return;
    }
  }

  // Step 1: API keys
  console.log(chalk.bold.white("\n  Step 1 of 3 — API Keys\n"));

  const envValues: Record<string, string> = {};

  for (const { key, label, hint, prefix } of REQUIRED_KEYS) {
    console.log(chalk.dim(`  Hint: ${hint}`));
    const { value } = await inquirer.prompt<{ value: string }>([
      {
        type: "password",
        name: "value",
        message: `  ${label}:`,
        validate: (v: string) => {
          if (v.length === 0) return `${label} is required`;
          if (prefix && !v.startsWith(prefix)) return `Should start with ${prefix}`;
          return true;
        },
      },
    ]);
    envValues[key] = value;
    console.log();
  }

  const { addOptional } = await inquirer.prompt<{ addOptional: boolean }>([
    {
      type: "confirm",
      name: "addOptional",
      message: "  Add optional keys now? (Exa web search, Apollo leads, Resend email)",
      default: false,
    },
  ]);

  if (addOptional) {
    for (const { key, label, hint } of OPTIONAL_KEYS) {
      console.log(chalk.dim(`  Hint: ${hint}`));
      const { value } = await inquirer.prompt<{ value: string }>([
        {
          type: "password",
          name: "value",
          message: `  ${label} (Enter to skip):`,
          default: "",
        },
      ]);
      if (value) envValues[key] = value;
      console.log();
    }
  }

  // Admin account
  console.log(chalk.bold.white("\n  Your account\n"));
  const { adminEmail, adminPassword } = await inquirer.prompt<{
    adminEmail: string;
    adminPassword: string;
  }>([
    {
      type: "input",
      name: "adminEmail",
      message: "  Email address:",
      validate: (v: string) => v.includes("@") || "Enter a valid email",
    },
    {
      type: "password",
      name: "adminPassword",
      message: "  Password (min 8 characters):",
      validate: (v: string) => v.length >= 8 || "Minimum 8 characters",
    },
  ]);

  // Step 2: Infrastructure
  console.log(chalk.bold.white("\n  Step 2 of 3 — Starting Infrastructure\n"));

  ensureComposeFile();
  writeConfig({ apiUrl: "http://localhost:4000", setupComplete: false });
  writeEnvFile(envValues);

  const pullSpinner = ora("  Pulling Docker images (first run may take 2-3 minutes)").start();
  try {
    await pullImages();
    pullSpinner.succeed("  Images ready");
  } catch {
    pullSpinner.warn("  Image pull had warnings — continuing");
  }

  const startSpinner = ora("  Starting Postgres, Redis, Qdrant, MinIO").start();
  try {
    await startServices();
    startSpinner.succeed("  Infrastructure running");
  } catch (err) {
    startSpinner.fail("  Failed to start services");
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Show what's running
  const statuses = await getServiceStatuses();
  for (const svc of statuses) {
    const icon = svc.status === "running" ? chalk.green("+") : chalk.red("-");
    console.log(`    ${icon} ${svc.name}`);
  }

  // Step 3: Account
  console.log(chalk.bold.white("\n  Step 3 of 3 — Creating Account\n"));

  const apiSpinner = ora("  Waiting for API server").start();
  const apiReady = await waitForApi("http://localhost:4000");
  if (!apiReady) {
    apiSpinner.warn("  API not responding — start it manually: pnpm --filter @mammoth/api dev");
    apiSpinner.warn("  Then run: mammoth auth login");
  } else {
    apiSpinner.succeed("  API ready");

    const authSpinner = ora("  Creating account").start();
    try {
      const authResult = await apiClient.signIn(adminEmail, adminPassword);
      saveToken(authResult.token, adminEmail);
      authSpinner.succeed(`  Signed in as ${adminEmail}`);
    } catch {
      authSpinner.warn("  Account creation failed — run: mammoth auth login");
    }
  }

  writeConfig({ setupComplete: true });

  // Done
  console.log();
  console.log(
    chalk.bold.white("  MAMMOTH is ready.\n")
  );
  console.log(chalk.dim("  mammoth status             check everything is running"));
  console.log(chalk.dim("  mammoth approve list       review pending AI actions"));
  console.log(chalk.dim("  mammoth trigger marketing  fire the marketing agent"));
  console.log(chalk.dim("  mammoth doctor             run health checks"));
  console.log();
}
