import {
  decimal,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";

export const companyMemory = pgTable(
  "company_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    memoryType: text("memory_type", {
      enum: [
        "identity",
        "brand_voice",
        "icp",
        "competitor",
        "customer_insight",
        "market_intel",
        "product_lesson",
        "playbook_refinement",
      ],
    }).notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    source: text("source"),
    confidence: decimal("confidence", { precision: 4, scale: 3 }),
    usageCount: integer("usage_count").default(0).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_memory_company_type").on(table.companyId, table.memoryType),
    unique("uq_memory_company_type_key").on(
      table.companyId,
      table.memoryType,
      table.key
    ),
  ]
);

export const memoryEmbeddings = pgTable("memory_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  memoryId: uuid("memory_id").references(() => companyMemory.id, {
    onDelete: "cascade",
  }),
  // SHA-256 of content — used to detect stale embeddings without re-reading value
  contentHash: text("content_hash").notNull(),
  qdrantPointId: uuid("qdrant_point_id").notNull(),
  model: text("model").default("text-embedding-3-small").notNull(),
  embeddedAt: timestamp("embedded_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type CompanyMemory = typeof companyMemory.$inferSelect;
export type NewCompanyMemory = typeof companyMemory.$inferInsert;
export type MemoryType = CompanyMemory["memoryType"];

export type MemoryEmbedding = typeof memoryEmbeddings.$inferSelect;
export type NewMemoryEmbedding = typeof memoryEmbeddings.$inferInsert;
