import { boolean, decimal, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";

export const LEARNING_SIGNAL_TYPES = [
  "approved",
  "vetoed",
  "modified",
  "eval_pass",
  "eval_fail",
] as const;
export type LearningSignalType = (typeof LEARNING_SIGNAL_TYPES)[number];

/**
 * Append-only stream of founder feedback and eval results.
 * The learning loop reads unprocessed rows, synthesizes department playbooks,
 * then marks rows as processed. Rows are never deleted — they form a
 * permanent audit trail of how each department improved over time.
 */
export const agentLearningSignals = pgTable(
  "agent_learning_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    department: text("department").notNull(),
    actionType: text("action_type").notNull(),
    signalType: text("signal_type", { enum: LEARNING_SIGNAL_TYPES }).notNull(),
    /** Agent's original output — stored so the synthesizer can compare before/after. */
    originalContent: text("original_content").notNull(),
    /** Founder's edited version when signalType === "modified". */
    correctedContent: text("corrected_content"),
    /** Free-text note from the founder explaining their edit (diffSummary). */
    correctionNote: text("correction_note"),
    /** Eval gate score (0–1) when signalType is eval_pass or eval_fail. */
    evalScore: decimal("eval_score", { precision: 4, scale: 3 }),
    /** True once this signal has been folded into a synthesis cycle. */
    isProcessed: boolean("is_processed").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_learning_signals_company_dept").on(
      table.companyId,
      table.department,
      table.isProcessed,
      table.createdAt
    ),
  ]
);

export type AgentLearningSignal = typeof agentLearningSignals.$inferSelect;
export type NewAgentLearningSignal = typeof agentLearningSignals.$inferInsert;
