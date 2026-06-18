import {
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";
import { users } from "./users.ts";

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    department: text("department").notNull(),
    runType: text("run_type", {
      enum: ["scheduled", "manual", "triggered"],
    }).notNull(),
    triggerSource: text("trigger_source"),
    status: text("status", {
      enum: ["running", "completed", "failed", "cancelled"],
    })
      .default("running")
      .notNull(),
    tasksCreated: integer("tasks_created").default(0).notNull(),
    tasksCompleted: integer("tasks_completed").default(0).notNull(),
    tasksFailed: integer("tasks_failed").default(0).notNull(),
    totalCostUsd: decimal("total_cost_usd", {
      precision: 10,
      scale: 6,
    }).default("0"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_agent_runs_company").on(table.companyId, table.startedAt),
  ]
);

// Append-only audit log — never UPDATE or DELETE rows
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    userId: uuid("user_id").references(() => users.id),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: uuid("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_audit_company").on(table.companyId, table.createdAt),
    index("idx_audit_action").on(table.action, table.createdAt),
  ]
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentRunStatus = AgentRun["status"];

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
