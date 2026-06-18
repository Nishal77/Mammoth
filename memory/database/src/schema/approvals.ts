import {
  decimal,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";
import { departmentTasks } from "./departments.ts";
import { users } from "./users.ts";

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => departmentTasks.id),
    department: text("department").notNull(),
    actionType: text("action_type").notNull(),
    ringLevel: smallint("ring_level").notNull(),
    outputContent: text("output_content").notNull(),
    contextSummary: text("context_summary"),
    confidence: decimal("confidence", { precision: 4, scale: 3 }),
    status: text("status", {
      enum: [
        "pending",
        "approved",
        "rejected",
        "modified",
        "auto-approved",
        "expired",
      ],
    })
      .default("pending")
      .notNull(),
    modifiedContent: text("modified_content"),
    diffSummary: text("diff_summary"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_approvals_company_status").on(
      table.companyId,
      table.status,
      table.createdAt
    ),
    // Partial index — only pending approvals need expiry scanning
    index("idx_approvals_expires").on(table.expiresAt),
  ]
);

export const trustScores = pgTable(
  "trust_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    department: text("department").notNull(),
    actionType: text("action_type").notNull(),
    consecutiveApprovals: integer("consecutive_approvals").default(0).notNull(),
    consecutiveUnmodified: integer("consecutive_unmodified")
      .default(0)
      .notNull(),
    // Current autonomy ring for this specific action type
    ringLevel: smallint("ring_level").default(2).notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("uq_trust_company_dept_action").on(
      table.companyId,
      table.department,
      table.actionType
    ),
  ]
);

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
export type ApprovalStatus = Approval["status"];
export type RingLevel = 1 | 2 | 3;

export type TrustScore = typeof trustScores.$inferSelect;
export type NewTrustScore = typeof trustScores.$inferInsert;
