import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Used in URL routing — must be URL-safe and unique
    slug: text("slug").unique().notNull(),
    tagline: text("tagline"),
    description: text("description"),
    industry: text("industry"),
    stage: text("stage", {
      enum: ["idea", "pre-revenue", "early-revenue", "growing", "scaling"],
    }),
    website: text("website"),
    logoUrl: text("logo_url"),
    brandVoice: text("brand_voice"),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    // Set when the owner subscribes to a MAMMOTH paid plan — used for billing portal and webhook lookup
    stripeCustomerId: text("stripe_customer_id"),
    // Optimistic lock — increment on every update, reject if stale
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_companies_owner").on(table.ownerId),
    index("idx_companies_slug").on(table.slug),
  ]
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type CompanyStage = NonNullable<Company["stage"]>;
