/**
 * Temporal worker entry point.
 *
 * This service:
 * - Connects to the Temporal server (Docker: localhost:7233)
 * - Registers all workflow definitions and activity implementations
 * - Processes tasks from the "mammoth-sales" task queue
 *
 * Run this alongside the agent-worker — they are complementary:
 * - BullMQ (agent-worker): single-step agent tasks, sub-minute jobs
 * - Temporal (this service): multi-day workflows that must survive crashes
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import * as salesActivities from "./activities/sales-activities.ts";
import { fileURLToPath } from "url";
import path from "path";

const TEMPORAL_ADDRESS = process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
const TASK_QUEUE = "mammoth-sales";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Workflow bundle path — Temporal compiles workflows in a sandbox
const WORKFLOW_PATH = path.join(__dirname, "workflows/sales-cycle-workflow.ts");

async function run(): Promise<void> {
  console.log(`[temporal-worker] Connecting to Temporal at ${TEMPORAL_ADDRESS}`);

  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOW_PATH,
    activities: salesActivities,
  });

  console.log(`[temporal-worker] Worker started on task queue "${TASK_QUEUE}"`);

  // Run until SIGTERM/SIGINT
  await worker.run();
}

run().catch((err: unknown) => {
  console.error("[temporal-worker] Fatal error:", err);
  process.exit(1);
});
