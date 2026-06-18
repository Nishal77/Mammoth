import {
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { approvals } from "./approvals.ts";
import { companies } from "./companies.ts";

export const contentPieces = pgTable(
  "content_pieces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contentType: text("content_type", {
      enum: [
        "blog_post",
        "social_twitter",
        "social_linkedin",
        "email_newsletter",
        "landing_page",
        "ad_copy",
        "press_release",
      ],
    }).notNull(),
    body: text("body"),
    metaDescription: text("meta_description"),
    targetKeyword: text("target_keyword"),
    seoScore: smallint("seo_score"),
    brandVoiceScore: smallint("brand_voice_score"),
    status: text("status", {
      enum: ["draft", "approved", "published", "archived"],
    })
      .default("draft")
      .notNull(),
    publishedUrl: text("published_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    performance: jsonb("performance").$type<{
      views?: number;
      clicks?: number;
      ranking?: number;
    }>(),
    approvalId: uuid("approval_id").references(() => approvals.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_content_company_type").on(
      table.companyId,
      table.contentType,
      table.status
    ),
  ]
);

export type ContentPiece = typeof contentPieces.$inferSelect;
export type NewContentPiece = typeof contentPieces.$inferInsert;
export type ContentType = ContentPiece["contentType"];
export type ContentStatus = ContentPiece["status"];
