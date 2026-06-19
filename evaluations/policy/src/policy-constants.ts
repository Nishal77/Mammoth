/**
 * Single source of truth for all ring-level policy rules.
 *
 * These are architectural constraints, not configuration.
 * Changing them requires a code review, not an env var.
 */

/** Actions that require Ring 3 explicit founder approval regardless of trust score. */
export const ALWAYS_RING_3: ReadonlySet<string> = new Set([
  "initiate_voice_call",
  "send_offer_letter",
  "execute_sprint_plan",
  "wire_transfer",
  "delete_data",
  "terminate_employee",
  "sign_contract",
  "publish_press_release",
]);

/**
 * Actions that are permanently blocked at the architecture level.
 * No ring, no approval, no override path.
 */
export const PERMANENTLY_BLOCKED: ReadonlySet<string> = new Set([
  "push_to_main",
  "drop_database",
  "delete_company",
  "revoke_founder_access",
  "disable_rls",
]);

/**
 * Finance is read-only by design. These action types are the only ones
 * finance may return without being escalated.
 * Any finance output with a type NOT in this set is escalated to Ring 3.
 */
export const FINANCE_READ_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  "generate_financial_report",
  "calculate_burn_rate",
  "calculate_runway",
  "analyze_mrr_trend",
  "generate_expense_summary",
  "forecast_revenue",
  "calculate_cac",
  "calculate_ltv",
]);

/** Env-sourced hard cap. Checked before every LLM call. */
export const MAX_DAILY_COST_USD = Number(
  process.env["MAX_AGENT_COST_PER_DAY_USD"] ?? 50
);
