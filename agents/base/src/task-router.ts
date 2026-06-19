import { MODELS } from "./model-router.js";
import type { ModelId } from "./model-router.js";

export type ContextScope = "minimal" | "standard" | "full";

export type TaskRoute = {
  /** Model to use — automatically selected based on task complexity. */
  model: ModelId;
  /** Hard ceiling on output tokens — prevents runaway generation. */
  maxOutputTokens: number;
  /** Which memory sections to load — controls input token size. */
  contextScope: ContextScope;
  /** Whether to mark the system prompt as cacheable (Anthropic prompt cache). */
  cacheSystemPrompt: boolean;
};

/**
 * Per-task routing table covering every task type across all 9 departments.
 *
 * Routing logic:
 *   HAIKU  — structured JSON extraction, classification, scoring, short output
 *   SONNET — long-form writing, multi-step reasoning, analysis, planning
 *
 * Context scope:
 *   minimal  — identity + goal + latest playbook only (≤ 10 rows)
 *   standard — + ICP, competitors, lessons, decision log (≤ 60 rows)
 *   full     — all memory types (≤ 200 rows) for CEO Brain and research
 */
const TASK_ROUTES: Record<string, TaskRoute> = {
  // ── Sales ──────────────────────────────────────────────────────────────────
  lead_research:      { model: MODELS.HAIKU,  maxOutputTokens: 2500, contextScope: "minimal",  cacheSystemPrompt: true },
  outreach_sequence:  { model: MODELS.SONNET, maxOutputTokens: 2000, contextScope: "standard", cacheSystemPrompt: true },
  crm_update:         { model: MODELS.HAIKU,  maxOutputTokens: 400,  contextScope: "minimal",  cacheSystemPrompt: true },

  // ── Marketing ──────────────────────────────────────────────────────────────
  // blog_post appears in both marketing and content — same route
  blog_post:          { model: MODELS.SONNET, maxOutputTokens: 3500, contextScope: "full",     cacheSystemPrompt: true },
  social_post:        { model: MODELS.HAIKU,  maxOutputTokens: 500,  contextScope: "minimal",  cacheSystemPrompt: true },
  email_campaign:     { model: MODELS.SONNET, maxOutputTokens: 1800, contextScope: "standard", cacheSystemPrompt: true },

  // ── Engineering ────────────────────────────────────────────────────────────
  sprint_planning:    { model: MODELS.SONNET, maxOutputTokens: 3000, contextScope: "standard", cacheSystemPrompt: true },
  pr_review:          { model: MODELS.SONNET, maxOutputTokens: 2500, contextScope: "minimal",  cacheSystemPrompt: true },
  issue_triage:       { model: MODELS.HAIKU,  maxOutputTokens: 700,  contextScope: "minimal",  cacheSystemPrompt: true },
  execute_sprint_plan:{ model: MODELS.SONNET, maxOutputTokens: 2000, contextScope: "standard", cacheSystemPrompt: true },

  // ── Finance ────────────────────────────────────────────────────────────────
  financial_report:   { model: MODELS.HAIKU,  maxOutputTokens: 2000, contextScope: "minimal",  cacheSystemPrompt: true },
  burn_analysis:      { model: MODELS.HAIKU,  maxOutputTokens: 800,  contextScope: "minimal",  cacheSystemPrompt: true },
  revenue_analysis:   { model: MODELS.HAIKU,  maxOutputTokens: 800,  contextScope: "minimal",  cacheSystemPrompt: true },

  // ── HR ─────────────────────────────────────────────────────────────────────
  create_job_description: { model: MODELS.SONNET, maxOutputTokens: 1800, contextScope: "standard", cacheSystemPrompt: true },
  screen_candidate:       { model: MODELS.HAIKU,  maxOutputTokens: 900,  contextScope: "minimal",  cacheSystemPrompt: true },
  draft_offer_letter:     { model: MODELS.SONNET, maxOutputTokens: 1500, contextScope: "standard", cacheSystemPrompt: true },

  // ── Research ───────────────────────────────────────────────────────────────
  competitor_intel:   { model: MODELS.SONNET, maxOutputTokens: 3000, contextScope: "full",     cacheSystemPrompt: true },
  market_analysis:    { model: MODELS.SONNET, maxOutputTokens: 3000, contextScope: "full",     cacheSystemPrompt: true },
  trend_report:       { model: MODELS.SONNET, maxOutputTokens: 2500, contextScope: "full",     cacheSystemPrompt: true },

  // ── Support ────────────────────────────────────────────────────────────────
  resolve_ticket:     { model: MODELS.HAIKU,  maxOutputTokens: 900,  contextScope: "standard", cacheSystemPrompt: true },
  create_kb_article:  { model: MODELS.HAIKU,  maxOutputTokens: 1500, contextScope: "standard", cacheSystemPrompt: true },
  initiate_voice_call:{ model: MODELS.HAIKU,  maxOutputTokens: 600,  contextScope: "minimal",  cacheSystemPrompt: true },

  // ── Content ────────────────────────────────────────────────────────────────
  // blog_post already defined above — shared key
  social_post_content:   { model: MODELS.HAIKU,  maxOutputTokens: 500,  contextScope: "minimal",  cacheSystemPrompt: true },
  content_calendar:      { model: MODELS.SONNET, maxOutputTokens: 2500, contextScope: "standard", cacheSystemPrompt: true },
  seo_content:           { model: MODELS.SONNET, maxOutputTokens: 3000, contextScope: "full",     cacheSystemPrompt: true },

  // ── CEO Brain ──────────────────────────────────────────────────────────────
  goal_decomposition: { model: MODELS.SONNET, maxOutputTokens: 4096, contextScope: "full",     cacheSystemPrompt: true },
  okr_setting:        { model: MODELS.SONNET, maxOutputTokens: 3000, contextScope: "full",     cacheSystemPrompt: true },
  pivot_detection:    { model: MODELS.SONNET, maxOutputTokens: 2000, contextScope: "full",     cacheSystemPrompt: true },
  weekly_briefing:    { model: MODELS.HAIKU,  maxOutputTokens: 1500, contextScope: "standard", cacheSystemPrompt: true },
};

const DEFAULT_ROUTE: TaskRoute = {
  model: MODELS.HAIKU,
  maxOutputTokens: 2048,
  contextScope: "standard",
  cacheSystemPrompt: true,
};

/**
 * Returns the optimal model, token budget, context scope, and cache flag
 * for a given task type. Falls back to a safe default for unknown task types.
 *
 * Called once per agent run — zero I/O, pure lookup.
 *
 * @param taskType - The agent task type string (e.g. "outreach_sequence")
 */
export function routeTask(taskType: string): TaskRoute {
  return TASK_ROUTES[taskType] ?? DEFAULT_ROUTE;
}
