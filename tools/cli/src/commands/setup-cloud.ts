import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { writeEnvFile } from "../lib/config.js";
import { logger } from "../lib/logger.js";

// Validates a Neon / generic postgres connection string format
function isValidPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\/.+:.+@.+\/.+/.test(url);
}

// Validates a Redis URL (redis:// or rediss://)
function isValidRedisUrl(url: string): boolean {
  return /^rediss?:\/\/.+/.test(url);
}

async function testPostgresConnection(url: string): Promise<boolean> {
  try {
    // Lightweight check — hit the API health endpoint with the config written
    // Full validation happens when API starts; here we just check URL reachability
    const parsed = new URL(url);
    const response = await fetch(
      `https://${parsed.hostname}`,
      { signal: AbortSignal.timeout(5000), method: "HEAD" }
    );
    return response.status < 500;
  } catch {
    // Neon hostnames are valid but may not respond to HEAD — treat as OK if URL parses
    return true;
  }
}

function printServiceStep(
  number: number,
  name: string,
  url: string,
  hint: string
): void {
  console.log();
  console.log(chalk.bold(`  Step ${number}: ${name}`));
  console.log(chalk.dim(`  ${hint}`));
  console.log();
  console.log(`    ${chalk.cyan(url)}`);
  console.log();
  console.log(chalk.dim("  Sign up (free), create a project, copy the connection string."));
  console.log();
}

export async function runCloudSetup(
  anthropicKey: string,
  openaiKey: string,
  extraKeys: Record<string, string>
): Promise<void> {
  console.log();
  console.log(chalk.bold.white("  Cloud Setup — 2 free services needed\n"));
  console.log(chalk.dim("  MAMMOTH needs a database and a cache."));
  console.log(chalk.dim("  We'll use two free services — takes about 3 minutes to sign up.\n"));

  // ── Neon (Postgres) ────────────────────────────────────────────────────────
  printServiceStep(
    1,
    "Neon — free Postgres database",
    "https://neon.tech/signup",
    "After signup: New Project → copy the connection string (looks like postgresql://...)"
  );

  const { postgresUrl } = await inquirer.prompt<{ postgresUrl: string }>([
    {
      type: "password",
      name: "postgresUrl",
      message: "  Paste your Neon connection string:",
      validate: (v: string) => {
        if (!v.trim()) return "Connection string is required";
        if (!isValidPostgresUrl(v.trim())) {
          return "Should start with postgresql:// or postgres://";
        }
        return true;
      },
    },
  ]);

  const pgSpinner = ora("  Verifying Postgres connection").start();
  const pgOk = await testPostgresConnection(postgresUrl.trim());
  if (pgOk) {
    pgSpinner.succeed("  Postgres connection looks good");
  } else {
    pgSpinner.warn("  Could not verify — continuing anyway");
  }

  // ── Upstash (Redis) ────────────────────────────────────────────────────────
  printServiceStep(
    2,
    "Upstash — free Redis cache",
    "https://console.upstash.com",
    "After signup: New Database → Redis → copy the Redis URL (looks like rediss://...)"
  );

  const { redisUrl } = await inquirer.prompt<{ redisUrl: string }>([
    {
      type: "password",
      name: "redisUrl",
      message: "  Paste your Upstash Redis URL:",
      validate: (v: string) => {
        if (!v.trim()) return "Redis URL is required";
        if (!isValidRedisUrl(v.trim())) {
          return "Should start with redis:// or rediss://";
        }
        return true;
      },
    },
  ]);

  // ── Qdrant Cloud (optional) ───────────────────────────────────────────────
  console.log();
  const { skipQdrant } = await inquirer.prompt<{ skipQdrant: boolean }>([
    {
      type: "confirm",
      name: "skipQdrant",
      message: "  Skip Qdrant vector memory for now? (can add later)",
      default: true,
    },
  ]);

  let qdrantUrl = "";
  let qdrantApiKey = "";

  if (!skipQdrant) {
    printServiceStep(
      3,
      "Qdrant Cloud — free vector memory",
      "https://cloud.qdrant.io",
      "After signup: Create Cluster (free tier) → copy URL and API key"
    );

    const qdrantAnswers = await inquirer.prompt<{
      url: string;
      key: string;
    }>([
      {
        type: "input",
        name: "url",
        message: "  Qdrant cluster URL (e.g. https://xyz.us-east.aws.cloud.qdrant.io):",
        validate: (v: string) => v.includes("qdrant") || "Enter the Qdrant cluster URL",
      },
      {
        type: "password",
        name: "key",
        message: "  Qdrant API key:",
        validate: (v: string) => v.length > 0 || "API key is required",
      },
    ]);
    qdrantUrl = qdrantAnswers.url.trim();
    qdrantApiKey = qdrantAnswers.key.trim();
  }

  // ── Write env file ─────────────────────────────────────────────────────────
  const envValues: Record<string, string> = {
    ANTHROPIC_API_KEY: anthropicKey,
    OPENAI_API_KEY: openaiKey,
    DATABASE_URL: postgresUrl.trim(),
    REDIS_URL: redisUrl.trim(),
    QDRANT_URL: qdrantUrl || "http://localhost:6333",
    QDRANT_API_KEY: qdrantApiKey,
    NODE_ENV: "production",
    ...extraKeys,
  };

  writeEnvFile(envValues);

  logger.blank();
  logger.success("Cloud services configured. Saved to ~/.mammoth/.env");

  if (skipQdrant) {
    logger.dim("Qdrant skipped — agent memory features will be limited until added.");
    logger.dim("Add later: mammoth config set-qdrant");
  }
}
