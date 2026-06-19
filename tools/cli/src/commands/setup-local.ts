import ora from "ora";
import { writeEnvFile } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import {
  checkDockerRunning,
  pullImages,
  startServices,
  getServiceStatuses,
  ensureComposeFile,
} from "../docker/compose-runner.js";

const LOCAL_DEFAULTS = {
  DATABASE_URL: "postgresql://mammoth:mammoth_dev@localhost:5432/mammoth",
  REDIS_URL: "redis://localhost:6379",
  REDIS_HOST: "localhost",
  REDIS_PORT: "6379",
  REDIS_PASSWORD: "",
  QDRANT_URL: "http://localhost:6333",
  QDRANT_API_KEY: "",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "minioadmin",
  S3_SECRET_KEY: "minioadmin_dev",
  S3_BUCKET: "mammoth",
  NODE_ENV: "development",
};

export async function runLocalSetup(
  anthropicKey: string,
  openaiKey: string,
  extraKeys: Record<string, string>
): Promise<void> {
  const dockerOk = await checkDockerRunning();
  if (!dockerOk) {
    logger.error("Docker is not running.");
    logger.dim("  Install Docker Desktop: https://mammoth.run/docker");
    logger.dim("  Start it, then re-run: mammoth init --local");
    process.exit(1);
  }

  ensureComposeFile();

  // Write env with local defaults
  writeEnvFile({
    ANTHROPIC_API_KEY: anthropicKey,
    OPENAI_API_KEY: openaiKey,
    ...LOCAL_DEFAULTS,
    ...extraKeys,
  });

  const pullSpinner = ora(
    "Pulling Docker images (first run: ~2-3 mins)"
  ).start();
  try {
    await pullImages();
    pullSpinner.succeed("Images ready");
  } catch {
    pullSpinner.warn("Image pull had warnings — continuing");
  }

  const startSpinner = ora(
    "Starting Postgres, Redis, Qdrant, MinIO"
  ).start();
  try {
    await startServices();
    startSpinner.succeed("All services running");
  } catch (err) {
    startSpinner.fail("Failed to start services");
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const statuses = await getServiceStatuses();
  for (const svc of statuses) {
    const icon = svc.status === "running" ? "+" : "-";
    logger.dim(`    ${icon} mammoth_${svc.name}`);
  }
}
