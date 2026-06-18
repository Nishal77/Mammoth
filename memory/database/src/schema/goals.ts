import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";

export const companyGoals = pgTable("company_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  type: text("type", { enum: ["revenue", "users", "other"] }).notNull(),
  targetValue: numeric("target_value", { precision: 18, scale: 2 }),
  currentValue: numeric("current_value", { precision: 18, scale: 2 }).default(
    "0"
  ),
  unit: text("unit").default("USD").notNull(),
  deadline: date("deadline"),
  status: text("status", {
    enum: ["active", "paused", "achieved", "abandoned"],
  })
    .default("active")
    .notNull(),
  // CEO Brain output: department-level OKRs and weekly targets
  decomposition: jsonb("decomposition").$type<{
    departments: Array<{
      name: string;
      okr: string;
      weeklyTarget: string;
    }>;
    milestones: Array<{
      week: number;
      target: string;
      metric: string;
    }>;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const strategyDecisions = pgTable(
  "strategy_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    decision: text("decision").notNull(),
    reasoning: text("reasoning"),
    madeBy: text("made_by", { enum: ["ai", "human"] }).notNull(),
    sourceAgent: text("source_agent"),
    tags: text("tags").array(),
    outcome: text("outcome"),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_strategy_company").on(table.companyId, table.createdAt),
  ]
);

export type CompanyGoal = typeof companyGoals.$inferSelect;
export type NewCompanyGoal = typeof companyGoals.$inferInsert;
export type GoalType = CompanyGoal["type"];
export type GoalStatus = CompanyGoal["status"];

export type StrategyDecision = typeof strategyDecisions.$inferSelect;
export type NewStrategyDecision = typeof strategyDecisions.$inferInsert;
