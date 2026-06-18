import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";
import { users } from "./users.ts";

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerName: text("customer_name"),
    priority: text("priority", {
      enum: ["low", "normal", "high", "urgent"],
    })
      .default("normal")
      .notNull(),
    status: text("status", {
      enum: ["open", "pending_reply", "resolved", "closed"],
    })
      .default("open")
      .notNull(),
    source: text("source", {
      enum: ["email", "chat", "form", "phone", "api"],
    })
      .default("email")
      .notNull(),
    tags: text("tags").array(),
    assignedTo: uuid("assigned_to").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_tickets_company_status").on(table.companyId, table.status),
    index("idx_tickets_customer").on(table.companyId, table.customerEmail),
  ]
);

export const knowledgeBaseArticles = pgTable(
  "knowledge_base_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    content: text("content").notNull(),
    category: text("category").notNull(),
    tags: text("tags").array(),
    status: text("status", {
      enum: ["draft", "published", "archived"],
    })
      .default("draft")
      .notNull(),
    viewCount: integer("view_count").default(0).notNull(),
    helpfulCount: integer("helpful_count").default(0).notNull(),
    notHelpfulCount: integer("not_helpful_count").default(0).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_kb_company_status").on(
      table.companyId,
      table.status,
      table.category
    ),
  ]
);

export type SupportTicket = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;
export type TicketStatus = SupportTicket["status"];
export type TicketPriority = SupportTicket["priority"];

export type KnowledgeBaseArticle = typeof knowledgeBaseArticles.$inferSelect;
export type NewKnowledgeBaseArticle =
  typeof knowledgeBaseArticles.$inferInsert;
