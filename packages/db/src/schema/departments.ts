import {
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";
import { companyGoals } from "./goals.ts";

export const DEPARTMENT_NAMES = [
  "ceo",
  "marketing",
  "sales",
  "engineering",
  "support",
  "finance",
  "research",
  "hr",
  "content",
] as const;

export type DepartmentName = (typeof DEPARTMENT_NAMES)[number];

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name", { enum: DEPARTMENT_NAMES }).notNull(),
    status: text("status", {
      enum: ["active", "paused", "inactive", "error"],
    })
      .default("inactive")
      .notNull(),
    ringDefaults: jsonb("ring_defaults")
      .$type<{ defaultRing: 1 | 2 | 3 }>()
      .default({ defaultRing: 2 })
      .notNull(),
    playbook: text("playbook"),
    playbookVersion: integer("playbook_version").default(1).notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("uq_departments_company_name").on(table.companyId, table.name),
  ]
);

export const departmentTasks = pgTable(
  "department_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    taskType: text("task_type").notNull(),
    priority: smallint("priority").default(5).notNull(),
    goalId: uuid("goal_id").references(() => companyGoals.id),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    })
      .default("queued")
      .notNull(),
    inputData: jsonb("input_data").$type<Record<string, unknown>>(),
    outputData: jsonb("output_data").$type<Record<string, unknown>>(),
    outputContent: text("output_content"),
    bullmqJobId: text("bullmq_job_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_tasks_company_status").on(
      table.companyId,
      table.status,
      table.createdAt
    ),
    index("idx_tasks_department").on(table.departmentId, table.createdAt),
  ]
);

export const taskRuns = pgTable(
  "task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => departmentTasks.id, { onDelete: "cascade" }),
    runNumber: smallint("run_number").default(1).notNull(),
    modelUsed: text("model_used"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    trace: jsonb("trace").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_task_runs_task").on(table.taskId)]
);

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
export type DepartmentStatus = Department["status"];

export type DepartmentTask = typeof departmentTasks.$inferSelect;
export type NewDepartmentTask = typeof departmentTasks.$inferInsert;
export type TaskStatus = DepartmentTask["status"];

export type TaskRun = typeof taskRuns.$inferSelect;
export type NewTaskRun = typeof taskRuns.$inferInsert;
