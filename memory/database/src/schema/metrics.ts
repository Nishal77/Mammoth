import {
  date,
  decimal,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";
import { users } from "./users.ts";

export const metricsDaily = pgTable(
  "metrics_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    mrr: numeric("mrr", { precision: 12, scale: 2 }),
    arr: numeric("arr", { precision: 12, scale: 2 }),
    newMrr: numeric("new_mrr", { precision: 12, scale: 2 }).default("0"),
    churnedMrr: numeric("churned_mrr", { precision: 12, scale: 2 }).default(
      "0"
    ),
    expansionMrr: numeric("expansion_mrr", {
      precision: 12,
      scale: 2,
    }).default("0"),
    activeCustomers: integer("active_customers"),
    newCustomers: integer("new_customers").default(0),
    churnedCustomers: integer("churned_customers").default(0),
    leadsCreated: integer("leads_created").default(0),
    emailsSent: integer("emails_sent").default(0),
    emailOpenRate: decimal("email_open_rate", { precision: 5, scale: 4 }),
    contentPublished: integer("content_published").default(0),
    websiteSessions: integer("website_sessions"),
    tasksRun: integer("tasks_run").default(0),
    aiCostUsd: decimal("ai_cost_usd", { precision: 10, scale: 4 }).default(
      "0"
    ),
  },
  (table) => [
    index("idx_metrics_company_date").on(table.companyId, table.date),
    unique("uq_metrics_company_date").on(table.companyId, table.date),
  ]
);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status", {
      enum: ["connected", "error", "revoked", "pending"],
    })
      .default("pending")
      .notNull(),
    // AES-256-GCM encrypted — key stored in KMS, never in env vars
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array(),
    metadata: text("metadata"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("uq_integrations_company_provider").on(
      table.companyId,
      table.provider
    ),
  ]
);

export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    briefingDate: date("briefing_date").notNull(),
    briefingType: text("briefing_type", { enum: ["daily", "weekly"] })
      .default("daily")
      .notNull(),
    summary: text("summary").notNull(),
    fullContent: text("full_content"),
    yesterdayHighlights: text("yesterday_highlights"),
    todayPlans: text("today_plans"),
    attentionItems: text("attention_items"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    channels: text("channels")
      .array()
      .$type<Array<"telegram" | "whatsapp" | "email">>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_briefings_company_date").on(
      table.companyId,
      table.briefingDate
    ),
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: text("data"),
    // Channels actually used to deliver this notification
    channels: text("channels")
      .array()
      .$type<Array<"telegram" | "whatsapp" | "email" | "in_app">>(),
    read: integer("read").default(0).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_notifications_user").on(
      table.userId,
      table.read,
      table.createdAt
    ),
  ]
);

export type MetricsDaily = typeof metricsDaily.$inferSelect;
export type NewMetricsDaily = typeof metricsDaily.$inferInsert;

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;
export type IntegrationStatus = Integration["status"];

export type Briefing = typeof briefings.$inferSelect;
export type NewBriefing = typeof briefings.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
