import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * Hot-updatable ring-level overrides. Loaded by BaseAgent every 5 minutes.
 * Defaults in policy-constants.ts are hardcoded and CANNOT be removed here —
 * this table can only ADD to the hardcoded sets, never remove from them.
 */
export const policyOverrides = pgTable(
  "policy_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleSet: text("rule_set", {
      enum: ["always_ring3", "permanently_blocked"],
    }).notNull(),
    actionType: text("action_type").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    /** Required audit trail — no anonymous policy changes. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_policy_overrides_active").on(table.ruleSet, table.isActive),
    index("idx_policy_overrides_action_type").on(table.actionType),
  ]
);

export type PolicyOverride = typeof policyOverrides.$inferSelect;
export type NewPolicyOverride = typeof policyOverrides.$inferInsert;
