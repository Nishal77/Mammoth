import { Worker, Queue, type Job } from "bullmq";
import { createLogger } from "@mammoth/observability/logger";

const log = createLogger("browser-worker");

const BROWSER_QUEUE_NAME = "browser:tasks";

const REDIS_CONNECTION = {
  host: process.env["REDIS_HOST"] ?? "localhost",
  port: Number(process.env["REDIS_PORT"] ?? 6379),
  password: process.env["REDIS_PASSWORD"] ?? undefined,
  maxRetriesPerRequest: null,
} as const;

export type BrowserTaskData = {
  companyId: string;
  taskType: "screenshot" | "scrape" | "form_fill";
  url: string;
  parameters?: Record<string, unknown>;
};

export const browserTaskQueue = new Queue<BrowserTaskData>(BROWSER_QUEUE_NAME, {
  connection: REDIS_CONNECTION,
});

/**
 * Browser automation worker — runs Playwright in isolated Docker containers.
 * Each task gets a fresh browser context with no shared state between companies.
 * No outbound network from the container except to the target URL.
 *
 * Security constraints (enforced at the container level):
 * - Non-root user
 * - Read-only filesystem (except /tmp)
 * - 30-second max execution time per task
 * - No localStorage or cookies persist between tasks
 */
const browserWorker = new Worker<BrowserTaskData>(
  BROWSER_QUEUE_NAME,
  async (job: Job<BrowserTaskData>) => {
    const { companyId, taskType, url, parameters } = job.data;
    const taskLog = log.withContext({ companyId, taskType, actionType: taskType });

    taskLog.info(`Processing browser task: ${taskType} on ${url}`);

    const { chromium } = await import("playwright");

    // Each task uses a completely isolated browser context — no shared state
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
      ],
    });

    const context = await browser.newContext({
      // Blank user agent to avoid bot detection
      userAgent:
        "Mozilla/5.0 (compatible; MAMMOTH-Agent/1.0; +https://mammoth.ai/bot)",
    });

    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 });

      if (taskType === "screenshot") {
        const screenshot = await page.screenshot({ fullPage: false });
        taskLog.info("Screenshot captured", { bytes: screenshot.length });
        return { screenshot: screenshot.toString("base64") };
      }

      if (taskType === "scrape") {
        const content = await page.content();
        taskLog.info("Page scraped", { bytes: content.length });
        return { html: content.slice(0, 100_000) };
      }

      taskLog.warn("Unknown browser task type", { taskType });
      return null;
    } finally {
      await context.close();
      await browser.close();
    }
  },
  {
    connection: REDIS_CONNECTION,
    concurrency: 3,
  }
);

browserWorker.on("failed", (job, error) => {
  log.errorWithStack(`Browser task ${job?.id ?? "unknown"} failed`, error);
});

browserWorker.on("error", (error) => {
  log.errorWithStack("Browser worker connection error", error);
});

log.info("Browser worker started", { queue: BROWSER_QUEUE_NAME });

const shutdown = async (signal: string): Promise<void> => {
  log.info(`Received ${signal}, shutting down`);
  await browserWorker.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
