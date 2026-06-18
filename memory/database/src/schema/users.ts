import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").unique().notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    emailVerified: boolean("email_verified").default(false).notNull(),
    plan: text("plan", {
      enum: ["free", "growth", "scale", "enterprise"],
    })
      .default("free")
      .notNull(),
    timezone: text("timezone").default("UTC").notNull(),
    notifyPrefs: jsonb("notify_prefs")
      .$type<{
        telegram: boolean;
        whatsapp: boolean;
        email: boolean;
        briefingTime: string; // HH:MM in user's timezone
      }>()
      .default({
        telegram: false,
        whatsapp: false,
        email: true,
        briefingTime: "07:00",
      })
      .notNull(),
    // Set during onboarding — used for Telegram bot DMs and WhatsApp messages
    telegramChatId: text("telegram_chat_id"),
    whatsappPhone: text("whatsapp_phone"), // E.164 format: +14155551234
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("idx_users_email").on(table.email)]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserPlan = User["plan"];
