import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { writeConfig, readConfig, type SetupMode } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { runCloudSetup } from "./setup-cloud.js";
import { runLocalSetup } from "./setup-local.js";
import { apiClient } from "../api/client.js";
import { saveToken } from "../auth/token-store.js";

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
  console.log();
  console.log(chalk.bold.white("  MAMMOTH Setup"));
  console.log(chalk.dim("  AI Company OS — mammoth.run\n"));
}

async function collectApiKeys(): Promise<{
  anthropicKey: string;
  openaiKey: string;
  extraKeys: Record<string, string>;
}> {
  console.log(chalk.bold("\n  API Keys\n"));
  console.log(chalk.dim("  MAMMOTH needs two keys to run agents.\n"));

  console.log(chalk.dim("  Get it at: console.anthropic.com → API Keys"));
  const { anthropicKey } = await inquirer.prompt<{ anthropicKey: string }>([
    {
      type: "password",
      name: "anthropicKey",
      message: "  Anthropic API key:",
      validate: (v: string) =>
        v.startsWith("sk-ant-") || "Should start with sk-ant-",
    },
  ]);

  console.log();
  console.log(chalk.dim("  Get it at: platform.openai.com → API Keys"));
  const { openaiKey } = await inquirer.prompt<{ openaiKey: string }>([
    {
      type: "password",
      name: "openaiKey",
      message: "  OpenAI API key (for embeddings):",
      validate: (v: string) =>
        v.startsWith("sk-") || "Should start with sk-",
    },
  ]);

  console.log();
  const { addMore } = await inquirer.prompt<{ addMore: boolean }>([
    {
      type: "confirm",
      name: "addMore",
      message: "  Add optional keys? (Exa search, Apollo leads, Resend email)",
      default: false,
    },
  ]);

  const extraKeys: Record<string, string> = {};

  if (addMore) {
    const optional = await inquirer.prompt<{
      exaKey: string;
      apolloKey: string;
      resendKey: string;
    }>([
      {
        type: "password",
        name: "exaKey",
        message: "  Exa API key (exa.ai) — leave blank to skip:",
        default: "",
      },
      {
        type: "password",
        name: "apolloKey",
        message: "  Apollo API key (apollo.io) — leave blank to skip:",
        default: "",
      },
      {
        type: "password",
        name: "resendKey",
        message: "  Resend API key (resend.com) — leave blank to skip:",
        default: "",
      },
    ]);
    if (optional.exaKey) extraKeys["EXA_API_KEY"] = optional.exaKey;
    if (optional.apolloKey) extraKeys["APOLLO_API_KEY"] = optional.apolloKey;
    if (optional.resendKey) extraKeys["RESEND_API_KEY"] = optional.resendKey;
  }

  return { anthropicKey, openaiKey, extraKeys };
}

async function collectAccount(): Promise<{
  email: string;
  password: string;
}> {
  console.log(chalk.bold("\n  Your Account\n"));

  return inquirer.prompt<{ email: string; password: string }>([
    {
      type: "input",
      name: "email",
      message: "  Email address:",
      validate: (v: string) => v.includes("@") || "Enter a valid email",
    },
    {
      type: "password",
      name: "password",
      message: "  Password (min 8 characters):",
      validate: (v: string) => v.length >= 8 || "Minimum 8 characters",
    },
  ]);
}

export async function runInit(forcedMode?: SetupMode): Promise<void> {
  printBanner();

  const config = readConfig();

  // Already configured — offer re-run
  if (config.setupComplete && !forcedMode) {
    const { redo } = await inquirer.prompt<{ redo: boolean }>([
      {
        type: "confirm",
        name: "redo",
        message: "  MAMMOTH is already set up. Re-run setup?",
        default: false,
      },
    ]);
    if (!redo) {
      logger.info("Run 'mammoth start' to start services.");
      return;
    }
  }

  // ── Mode selection ──────────────────────────────────────────────────────────
  let mode: SetupMode;

  if (forcedMode) {
    mode = forcedMode;
  } else {
    console.log(chalk.bold("\n  How do you want to run MAMMOTH?\n"));
    console.log(
      chalk.white("  Cloud ") +
        chalk.dim("(recommended)") +
        chalk.dim(" — no Docker needed, uses free cloud services, ready in 3 minutes")
    );
    console.log(
      chalk.white("  Local ") +
        chalk.dim("               — everything on your machine, Docker required\n")
    );

    const { selectedMode } = await inquirer.prompt<{
      selectedMode: SetupMode;
    }>([
      {
        type: "list",
        name: "selectedMode",
        message: "  Choose setup mode:",
        choices: [
          { name: "Cloud  (recommended — no Docker)", value: "cloud" },
          { name: "Local  (Docker required, full control)", value: "local" },
        ],
      },
    ]);
    mode = selectedMode;
  }

  writeConfig({ mode });

  // ── API keys ────────────────────────────────────────────────────────────────
  const { anthropicKey, openaiKey, extraKeys } = await collectApiKeys();

  // ── Mode-specific setup ─────────────────────────────────────────────────────
  console.log(chalk.bold(`\n  Setting up ${mode === "cloud" ? "Cloud" : "Local"} infrastructure\n`));

  if (mode === "cloud") {
    await runCloudSetup(anthropicKey, openaiKey, extraKeys);
  } else {
    await runLocalSetup(anthropicKey, openaiKey, extraKeys);
  }

  // ── Account setup ───────────────────────────────────────────────────────────
  const { email, password } = await collectAccount();

  // ── Wait for API ────────────────────────────────────────────────────────────
  const apiSpinner = ora("  Waiting for API server to start").start();
  const apiUrl = config.apiUrl ?? "http://localhost:4000";
  const apiReady = await waitForApi(apiUrl);

  if (!apiReady) {
    apiSpinner.warn("  API not responding yet");
    logger.dim("  Start it manually:");
    if (mode === "local") {
      logger.dim("    pnpm --filter @mammoth/api dev");
    } else {
      logger.dim("    Start the MAMMOTH API server, then run: mammoth auth login");
    }
  } else {
    apiSpinner.succeed("  API ready");

    const authSpinner = ora("  Creating account").start();
    try {
      const authResult = await apiClient.signIn(email, password);
      saveToken(authResult.token, email);
      authSpinner.succeed(`  Signed in as ${email}`);
    } catch {
      authSpinner.warn("  Could not create session — run: mammoth auth login");
    }
  }

  writeConfig({ setupComplete: true });

  // ── Done ────────────────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.bold.green("  MAMMOTH is ready.\n"));
  console.log(chalk.dim("  mammoth status          — check everything running"));
  console.log(chalk.dim("  mammoth approve list    — review pending AI actions"));
  console.log(chalk.dim("  mammoth trigger sales   — fire the sales agent"));
  console.log(chalk.dim("  mammoth doctor          — run health checks"));
  console.log();
  console.log(chalk.dim("  Open dashboard: http://localhost:3000"));
  console.log();
}
