import {
  decimal,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    title: text("title"),
    companyName: text("company_name"),
    companyDomain: text("company_domain"),
    companySize: text("company_size"),
    industry: text("industry"),
    externalId: text("external_id"),
    source: text("source").default("agent:sales").notNull(),
    icpScore: decimal("icp_score", { precision: 4, scale: 3 }),
    enrichmentData: jsonb("enrichment_data").$type<Record<string, unknown>>(),
    status: text("status", {
      enum: [
        "new",
        "researched",
        "in_sequence",
        "replied",
        "meeting_booked",
        "converted",
        "disqualified",
      ],
    })
      .default("new")
      .notNull(),
    disqualifyReason: text("disqualify_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_leads_company_status").on(table.companyId, table.status),
    index("idx_leads_email").on(table.companyId, table.email),
  ]
);

export const outreachSequences = pgTable(
  "outreach_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    stepNumber: smallint("step_number").notNull(),
    channel: text("channel", { enum: ["email", "linkedin", "sms"] })
      .default("email")
      .notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    replySentiment: text("reply_sentiment", {
      enum: ["positive", "neutral", "negative", "unsubscribe"],
    }),
    replyBody: text("reply_body"),
    status: text("status", {
      enum: ["queued", "sent", "opened", "replied", "failed", "skipped"],
    })
      .default("queued")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_sequences_company").on(table.companyId, table.status),
    index("idx_sequences_send").on(table.sendAt),
  ]
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    name: text("name").notNull(),
    email: text("email"),
    companyName: text("company_name"),
    mrr: numeric("mrr", { precision: 12, scale: 2 }).default("0"),
    plan: text("plan"),
    healthScore: decimal("health_score", { precision: 4, scale: 3 }).default(
      "0.500"
    ),
    churnRisk: decimal("churn_risk", { precision: 4, scale: 3 }).default(
      "0.000"
    ),
    npsScore: smallint("nps_score"),
    npsCategory: text("nps_category", {
      enum: ["promoter", "passive", "detractor"],
    }),
    tags: text("tags").array(),
    notes: text("notes"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_customers_company").on(table.companyId),
    index("idx_customers_churn").on(table.companyId, table.churnRisk),
  ]
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadStatus = Lead["status"];

export type OutreachSequence = typeof outreachSequences.$inferSelect;
export type NewOutreachSequence = typeof outreachSequences.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
