/**
 * Policy engine for AI action authorization.
 * Enforces architectural constraints that cannot be overridden by agent logic.
 * Called by the execution worker before any action is dispatched.
 */

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
};

type PolicyContext = {
  companyId: string;
  department: string;
  actionType: string;
  ringLevel: number;
  estimatedCostUsd?: number;
  dailyCostSoFarUsd?: number;
};

// Finance is read-only by architecture — no action type may write from it
const FINANCE_BLOCKED = true;

// These action types require Ring 3 regardless of trust score
const ALWAYS_RING_3: ReadonlySet<string> = new Set([
  "initiate_voice_call",
  "send_offer_letter",
  "execute_sprint_plan",
  "wire_transfer",
  "delete_data",
]);

// These action types are completely blocked — no ring can authorize them
const PERMANENTLY_BLOCKED: ReadonlySet<string> = new Set([
  "push_to_main",
  "drop_database",
  "delete_company",
  "revoke_founder_access",
]);

const MAX_DAILY_COST_USD = Number(process.env["MAX_AGENT_COST_PER_DAY_USD"] ?? 50);

/**
 * Evaluates whether an action is permitted under MAMMOTH's policy rules.
 * Returns a decision with a human-readable reason for audit logging.
 *
 * @param ctx - The action being evaluated
 */
export function evaluateActionPolicy(ctx: PolicyContext): PolicyDecision {
  // Hard block — Finance cannot initiate any action
  if (FINANCE_BLOCKED && ctx.department === "finance") {
    return {
      allowed: false,
      reason: `Finance department is read-only by architecture. Action "${ctx.actionType}" blocked.`,
    };
  }

  // Permanently blocked actions — no override path
  if (PERMANENTLY_BLOCKED.has(ctx.actionType)) {
    return {
      allowed: false,
      reason: `Action "${ctx.actionType}" is permanently blocked at the policy level.`,
    };
  }

  // Ring level enforcement — certain actions require Ring 3 regardless of trust
  if (ALWAYS_RING_3.has(ctx.actionType) && ctx.ringLevel < 3) {
    return {
      allowed: false,
      reason: `Action "${ctx.actionType}" requires Ring 3 explicit approval. Current ring: ${ctx.ringLevel}.`,
    };
  }

  // Daily cost cap — hard stop before dispatch
  if (
    ctx.estimatedCostUsd !== undefined &&
    ctx.dailyCostSoFarUsd !== undefined &&
    ctx.dailyCostSoFarUsd + ctx.estimatedCostUsd > MAX_DAILY_COST_USD
  ) {
    return {
      allowed: false,
      reason: `Daily cost cap reached. Daily limit: $${MAX_DAILY_COST_USD}. Used: $${ctx.dailyCostSoFarUsd.toFixed(2)}.`,
    };
  }

  return { allowed: true, reason: "Policy check passed." };
}

/**
 * Validates that the ring level assigned to an action matches policy requirements.
 * Agents call this before creating an approval to catch misconfigured ring levels.
 */
export function assertRingLevelValid(actionType: string, ringLevel: 1 | 2 | 3): void {
  if (ALWAYS_RING_3.has(actionType) && ringLevel < 3) {
    throw new Error(
      `Policy violation: "${actionType}" must be Ring 3. Attempted ring: ${ringLevel}.`
    );
  }
}
