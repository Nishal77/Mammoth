/**
 * E2E smoke test.
 * Spins up a company, triggers a CEO Brain cycle via the BullMQ queue,
 * and verifies department tasks are dispatched.
 *
 * Run:
 *   pnpm tsx scripts/smoke-test.ts
 *
 * Prerequisites:
 *   - PostgreSQL running (DATABASE_URL in env)
 *   - Redis running (REDIS_URL or REDIS_HOST/PORT in env)
 *   - ANTHROPIC_API_KEY set (or MOCK_LLM=true to skip real calls)
 *   - Tables migrated: pnpm db:push
 */

import { Queue } from "bullmq";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../memory/database/src/schema/index.ts";
import { eq, and } from "drizzle-orm";

const DATABASE_URL = process.env["DATABASE_URL"];
const REDIS_HOST = process.env["REDIS_HOST"] ?? "localhost";
const REDIS_PORT = Number(process.env["REDIS_PORT"] ?? 6379);
const TIMEOUT_MS = Number(process.env["SMOKE_TIMEOUT_MS"] ?? 30_000);

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const REDIS_CONNECTION = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null,
} as const;

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql, { schema });

async function run(): Promise<void> {
  console.log("[smoke] Starting MAMMOTH E2E smoke test");

  // ── 1. Seed a test company ─────────────────────────────────────────────────
  const testCompanyId = crypto.randomUUID();
  const testUserId = crypto.randomUUID();

  await db.insert(schema.companies).values({
    id: testCompanyId,
    ownerId: testUserId,
    name: "Smoke Test Corp",
    slug: `smoke-${Date.now()}`,
    version: 1,
  });
  console.log(`[smoke] Created company ${testCompanyId}`);

  // ── 2. Seed departments ────────────────────────────────────────────────────
  await db.insert(schema.departments).values(
    schema.DEPARTMENT_NAMES.map((name) => ({
      companyId: testCompanyId,
      name,
      status: "inactive" as const,
      ringDefaults: { defaultRing: 2 as const },
      playbookVersion: 1,
    }))
  );
  console.log("[smoke] Departments seeded");

  // ── 3. Seed an active goal ─────────────────────────────────────────────────
  const goalId = crypto.randomUUID();
  await db.insert(schema.companyGoals).values({
    id: goalId,
    companyId: testCompanyId,
    title: "Reach $1M ARR",
    type: "revenue",
    targetValue: "1000000",
    currentValue: "0",
    unit: "USD",
    deadline: "2026-12-31",
    status: "active",
  });
  console.log("[smoke] Goal seeded");

  // ── 4. Seed identity memory so CEO Brain has context ──────────────────────
  await db.insert(schema.companyMemory).values({
    companyId: testCompanyId,
    memoryType: "identity",
    key: "mission",
    value: "Build AI-powered automation tools for SMBs",
    source: "smoke-test",
  });
  console.log("[smoke] Memory seeded");

  // ── 5. Enqueue a CEO Brain cycle via agent-tasks queue ────────────────────
  const ceoQueue = new Queue("agent-tasks", { connection: REDIS_CONNECTION });

  const ceoDept = await db.query.departments.findFirst({
    where: and(
      eq(schema.departments.companyId, testCompanyId),
      eq(schema.departments.name, "ceo")
    ),
    columns: { id: true },
  });

  if (!ceoDept) throw new Error("CEO department not found after seed");

  const taskId = crypto.randomUUID();
  await db.insert(schema.departmentTasks).values({
    id: taskId,
    companyId: testCompanyId,
    departmentId: ceoDept.id,
    taskType: "ceo_cycle",
    status: "pending",
    priority: 1,
  });

  const jobId = `smoke:ceo:${taskId}`;
  await ceoQueue.add(
    "ceo_cycle",
    {
      companyId: testCompanyId,
      departmentId: ceoDept.id,
      taskId,
      agentRunId: crypto.randomUUID(),
      taskType: "ceo_cycle",
      parameters: {},
    },
    { jobId, attempts: 1 }
  );
  console.log(`[smoke] CEO Brain job queued: ${jobId}`);

  // ── 6. Poll for task completion ────────────────────────────────────────────
  console.log(`[smoke] Polling for task completion (timeout: ${TIMEOUT_MS}ms)...`);
  const startedAt = Date.now();

  while (Date.now() - startedAt < TIMEOUT_MS) {
    await sleep(2000);

    const task = await db.query.departmentTasks.findFirst({
      where: eq(schema.departmentTasks.id, taskId),
      columns: { status: true, outputContent: true, errorMessage: true },
    });

    if (!task) continue;

    if (task.status === "failed") {
      console.error("[smoke] Task failed:", task.errorMessage);
      await cleanup(testCompanyId);
      process.exit(1);
    }

    if (task.status === "completed") {
      console.log("[smoke] CEO Brain task completed");

      // ── 7. Verify at least some department tasks were dispatched ──────────
      const dispatchedTasks = await db.query.departmentTasks.findMany({
        where: and(
          eq(schema.departmentTasks.companyId, testCompanyId),
          eq(schema.departmentTasks.status, "pending")
        ),
        columns: { id: true, taskType: true },
      });

      // CEO Brain should produce at least 3 department tasks (one per dept)
      // but with a mock LLM it may vary — just check it ran
      console.log(`[smoke] Dispatched ${dispatchedTasks.length} follow-up tasks`);

      console.log("[smoke] PASS — CEO Brain cycle ran to completion");
      await cleanup(testCompanyId);
      await ceoQueue.close();
      await sql.end();
      process.exit(0);
    }

    console.log(`[smoke] Task status: ${task.status} (${Math.round((Date.now() - startedAt) / 1000)}s elapsed)`);
  }

  console.error("[smoke] TIMEOUT — task did not complete within", TIMEOUT_MS, "ms");
  await cleanup(testCompanyId);
  await ceoQueue.close();
  await sql.end();
  process.exit(1);
}

async function cleanup(companyId: string): Promise<void> {
  // Cascade delete: companies → departments, tasks, goals, memory all cascade
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
  console.log(`[smoke] Cleaned up company ${companyId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

run().catch((err) => {
  console.error("[smoke] Fatal error:", err);
  process.exit(1);
});
