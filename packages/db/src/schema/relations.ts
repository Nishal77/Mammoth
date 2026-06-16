import { relations } from "drizzle-orm";
import { users } from "./users.ts";
import { companies } from "./companies.ts";
import { companyGoals, strategyDecisions } from "./goals.ts";
import { companyMemory, memoryEmbeddings } from "./memory.ts";
import { departments, departmentTasks, taskRuns } from "./departments.ts";
import { approvals, trustScores } from "./approvals.ts";
import { leads, outreachSequences, customers } from "./sales.ts";
import { contentPieces } from "./content.ts";
import { metricsDaily, integrations, briefings, notifications } from "./metrics.ts";
import { agentRuns, auditLog } from "./audit.ts";

// ---- users ----
export const usersRelations = relations(users, ({ many }) => ({
  companies: many(companies),
  notifications: many(notifications),
}));

// ---- companies ----
export const companiesRelations = relations(companies, ({ one, many }) => ({
  owner: one(users, { fields: [companies.ownerId], references: [users.id] }),
  goals: many(companyGoals),
  departments: many(departments),
  memory: many(companyMemory),
  leads: many(leads),
  customers: many(customers),
  content: many(contentPieces),
  metrics: many(metricsDaily),
  integrations: many(integrations),
  briefings: many(briefings),
  approvals: many(approvals),
  trustScores: many(trustScores),
  agentRuns: many(agentRuns),
  auditLogs: many(auditLog),
}));

// ---- goals ----
export const companyGoalsRelations = relations(companyGoals, ({ one, many }) => ({
  company: one(companies, {
    fields: [companyGoals.companyId],
    references: [companies.id],
  }),
  decisions: many(strategyDecisions),
  tasks: many(departmentTasks),
}));

export const strategyDecisionsRelations = relations(strategyDecisions, ({ one }) => ({
  company: one(companies, {
    fields: [strategyDecisions.companyId],
    references: [companies.id],
  }),
  goal: one(companyGoals, {
    fields: [strategyDecisions.goalId],
    references: [companyGoals.id],
  }),
}));

// ---- memory ----
export const companyMemoryRelations = relations(companyMemory, ({ one, many }) => ({
  company: one(companies, {
    fields: [companyMemory.companyId],
    references: [companies.id],
  }),
  embeddings: many(memoryEmbeddings),
}));

export const memoryEmbeddingsRelations = relations(memoryEmbeddings, ({ one }) => ({
  memory: one(companyMemory, {
    fields: [memoryEmbeddings.memoryId],
    references: [companyMemory.id],
  }),
}));

// ---- departments ----
export const departmentsRelations = relations(departments, ({ one, many }) => ({
  company: one(companies, {
    fields: [departments.companyId],
    references: [companies.id],
  }),
  tasks: many(departmentTasks),
}));

export const departmentTasksRelations = relations(departmentTasks, ({ one, many }) => ({
  company: one(companies, {
    fields: [departmentTasks.companyId],
    references: [companies.id],
  }),
  department: one(departments, {
    fields: [departmentTasks.departmentId],
    references: [departments.id],
  }),
  goal: one(companyGoals, {
    fields: [departmentTasks.goalId],
    references: [companyGoals.id],
  }),
  runs: many(taskRuns),
  approval: one(approvals, {
    fields: [departmentTasks.id],
    references: [approvals.taskId],
  }),
}));

export const taskRunsRelations = relations(taskRuns, ({ one }) => ({
  task: one(departmentTasks, {
    fields: [taskRuns.taskId],
    references: [departmentTasks.id],
  }),
}));

// ---- approvals ----
export const approvalsRelations = relations(approvals, ({ one }) => ({
  company: one(companies, {
    fields: [approvals.companyId],
    references: [companies.id],
  }),
  task: one(departmentTasks, {
    fields: [approvals.taskId],
    references: [departmentTasks.id],
  }),
  resolvedByUser: one(users, {
    fields: [approvals.resolvedBy],
    references: [users.id],
  }),
}));

export const trustScoresRelations = relations(trustScores, ({ one }) => ({
  company: one(companies, {
    fields: [trustScores.companyId],
    references: [companies.id],
  }),
}));

// ---- sales ----
export const leadsRelations = relations(leads, ({ one, many }) => ({
  company: one(companies, {
    fields: [leads.companyId],
    references: [companies.id],
  }),
  sequences: many(outreachSequences),
}));

export const outreachSequencesRelations = relations(outreachSequences, ({ one }) => ({
  lead: one(leads, {
    fields: [outreachSequences.leadId],
    references: [leads.id],
  }),
}));

export const customersRelations = relations(customers, ({ one }) => ({
  company: one(companies, {
    fields: [customers.companyId],
    references: [companies.id],
  }),
}));

// ---- content ----
export const contentPiecesRelations = relations(contentPieces, ({ one }) => ({
  company: one(companies, {
    fields: [contentPieces.companyId],
    references: [companies.id],
  }),
  approval: one(approvals, {
    fields: [contentPieces.approvalId],
    references: [approvals.id],
  }),
}));

// ---- metrics ----
export const metricsDailyRelations = relations(metricsDaily, ({ one }) => ({
  company: one(companies, {
    fields: [metricsDaily.companyId],
    references: [companies.id],
  }),
}));

export const integrationsRelations = relations(integrations, ({ one }) => ({
  company: one(companies, {
    fields: [integrations.companyId],
    references: [companies.id],
  }),
}));

export const briefingsRelations = relations(briefings, ({ one }) => ({
  company: one(companies, {
    fields: [briefings.companyId],
    references: [companies.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  company: one(companies, {
    fields: [notifications.companyId],
    references: [companies.id],
  }),
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

// ---- audit ----
export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  company: one(companies, {
    fields: [agentRuns.companyId],
    references: [companies.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  company: one(companies, {
    fields: [auditLog.companyId],
    references: [companies.id],
  }),
}));
