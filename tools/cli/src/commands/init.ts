import inquirer from "inquirer";
import fs from "node:fs";
import path from "node:path";
import ora from "ora";
import { writeConfig, readConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { checkDockerRunning, pullImages, startServices } from "../docker/compose-runner.js";
import { apiClient } from "../api/client.js";
import { saveToken } from "../auth/token-store.js";

const REQUIRED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
];

const OPTIONAL_ENV_KEYS = [
  "EXA_API_KEY",
  "APOLLO_API_KEY",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "VAPI_API_KEY",
  "GITHUB_WEBHOOK_SECRET",
];

function buildEnvFile(values: Record<string, string>, projectRoot: string): string {
  const examplePath = path.join(projectRoot, ".env.example");
  if (!fs.existsSync(examplePath)) {
    throw new Error(`.env.example not found at ${projectRoot}`);
  }

  let content = fs.readFileSync(examplePath, "utf-8");

  for (const [key, val] of Object.entries(values)) {
    if (!val) continue;
    // Replace the key=... line with the real value
    content = content.replace(
      new RegExp(`^(${key}=).*$`, "m"),
      `$1${val}`
    );
  }

  return content;
}

async function waitForApi(maxAttempts = 20): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await apiClient.health();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return false;
}

export async function runInit(): Promise<void> {
  logger.header("MAMMOTH Setup Wizard");
  logger.dim("Sets up infrastructure and creates your admin account.");
  logger.blank();

  const dockerRunning = await checkDockerRunning();
  if (!dockerRunning) {
    logger.error("Docker is not running. Start Docker Desktop then retry.");
    process.exit(1);
  }

  const config = readConfig();
  const projectRoot = config.projectRoot;

  const examplePath = path.join(projectRoot, ".env.example");
  if (!fs.existsSync(examplePath)) {
    logger.error(`Not in MAMMOTH project root. Run this command from the cloned mammoth/ directory.`);
    process.exit(1);
  }

  const envPath = path.join(projectRoot, ".env.local");
  if (fs.existsSync(envPath)) {
    const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
      {
        type: "confirm",
        name: "overwrite",
        message: ".env.local already exists. Overwrite?",
        default: false,
      },
    ]);
    if (!overwrite) {
      logger.info("Skipping env setup. Using existing .env.local");
      return skipToStart(projectRoot, envPath);
    }
  }

  // Collect API keys
  const requiredAnswers = await inquirer.prompt<Record<string, string>>(
    REQUIRED_ENV_KEYS.map((key) => ({
      type: "password",
      name: key,
      message: `${key}:`,
      validate: (v: string) => v.length > 0 || `${key} is required`,
    }))
  );

  const { collectOptional } = await inquirer.prompt<{ collectOptional: boolean }>([
    {
      type: "confirm",
      name: "collectOptional",
      message: "Add optional keys now (Exa, Apollo, Resend, Stripe, Vapi)?",
      default: false,
    },
  ]);

  const optionalAnswers: Record<string, string> = {};
  if (collectOptional) {
    const answers = await inquirer.prompt<Record<string, string>>(
      OPTIONAL_ENV_KEYS.map((key) => ({
        type: "password",
        name: key,
        message: `${key} (leave blank to skip):`,
        default: "",
      }))
    );
    Object.assign(optionalAnswers, answers);
  }

  // Admin account
  const { adminEmail, adminPassword } = await inquirer.prompt<{
    adminEmail: string;
    adminPassword: string;
  }>([
    {
      type: "input",
      name: "adminEmail",
      message: "Admin email:",
      validate: (v: string) => v.includes("@") || "Enter a valid email",
    },
    {
      type: "password",
      name: "adminPassword",
      message: "Admin password (min 8 chars):",
      validate: (v: string) => v.length >= 8 || "Minimum 8 characters",
    },
  ]);

  // Write .env.local
  const spinner = ora("Writing .env.local").start();
  const envValues = { ...requiredAnswers, ...optionalAnswers };
  const envContent = buildEnvFile(envValues, projectRoot);
  fs.writeFileSync(envPath, envContent, { mode: 0o600 });
  spinner.succeed(".env.local written");

  writeConfig({ projectRoot, envPath, setupComplete: false });

  // Pull Docker images
  const pullSpinner = ora("Pulling Docker images (this may take a few minutes on first run)").start();
  try {
    await pullImages();
    pullSpinner.succeed("Images ready");
  } catch {
    pullSpinner.warn("Image pull had warnings — continuing");
  }

  // Start services
  const startSpinner = ora("Starting Postgres, Redis, Qdrant, MinIO").start();
  await startServices();
  startSpinner.succeed("Services started");

  // Run migrations
  const migrateSpinner = ora("Running database migrations").start();
  try {
    const { execa } = await import("execa");
    await execa("pnpm", ["db:migrate"], {
      cwd: projectRoot,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    });
    migrateSpinner.succeed("Migrations complete");
  } catch {
    migrateSpinner.fail("Migrations failed — check .env.local DATABASE_URL");
    process.exit(1);
  }

  // Wait for API
  const apiSpinner = ora("Waiting for API to start").start();
  const apiReady = await waitForApi();
  if (!apiReady) {
    apiSpinner.warn("API not responding yet. Start manually: pnpm --filter @mammoth/api dev");
  } else {
    apiSpinner.succeed("API ready");

    // Create admin account
    const authSpinner = ora("Creating admin account").start();
    try {
      const authResult = await apiClient.signIn(adminEmail, adminPassword);
      saveToken(authResult.token, adminEmail);
      authSpinner.succeed(`Logged in as ${adminEmail}`);
    } catch {
      authSpinner.warn("Could not create session — run: mammoth auth login");
    }
  }

  writeConfig({ setupComplete: true });

  logger.blank();
  logger.success("MAMMOTH is ready.");
  logger.blank();
  logger.dim("Next steps:");
  logger.dim("  mammoth status          — check services");
  logger.dim("  mammoth company create  — onboard a company");
  logger.dim("  mammoth approve list    — view pending approvals");
}

async function skipToStart(projectRoot: string, envPath: string): Promise<void> {
  writeConfig({ projectRoot, envPath });

  const spinner = ora("Starting services").start();
  await startServices();
  spinner.succeed("Services started");
}
