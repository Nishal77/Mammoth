import {
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.ts";

export const jobPostings = pgTable(
  "job_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    department: text("department").notNull(),
    seniority: text("seniority").notNull(),
    summary: text("summary").notNull(),
    requirements: jsonb("requirements")
      .$type<{
        mustHave: string[];
        niceToHave: string[];
      }>()
      .notNull(),
    responsibilities: text("responsibilities").array().notNull(),
    compensationRange: text("compensation_range"),
    workStyle: text("work_style", {
      enum: ["remote", "hybrid", "onsite"],
    })
      .default("remote")
      .notNull(),
    status: text("status", {
      enum: ["draft", "published", "closed", "filled"],
    })
      .default("draft")
      .notNull(),
    publishedUrl: text("published_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_job_postings_company").on(table.companyId, table.status),
  ]
);

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    jobPostingId: uuid("job_posting_id").references(() => jobPostings.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    resumeUrl: text("resume_url"),
    resumeSummary: text("resume_summary"),
    experienceYears: smallint("experience_years"),
    skills: text("skills").array(),
    fitScore: smallint("fit_score"),
    status: text("status", {
      enum: [
        "new",
        "screening",
        "interview",
        "offer",
        "hired",
        "rejected",
        "withdrawn",
      ],
    })
      .default("new")
      .notNull(),
    screeningNotes: text("screening_notes"),
    source: text("source").default("direct").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_candidates_company_status").on(
      table.companyId,
      table.status
    ),
    index("idx_candidates_job").on(table.jobPostingId),
  ]
);

export type JobPosting = typeof jobPostings.$inferSelect;
export type NewJobPosting = typeof jobPostings.$inferInsert;

export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
export type CandidateStatus = Candidate["status"];
