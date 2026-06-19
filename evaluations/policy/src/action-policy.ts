import {
  ALWAYS_RING_3,
  PERMANENTLY_BLOCKED,
  MAX_DAILY_COST_USD,
} from "./policy-constants.js";

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

/**
 * Evaluates whether an action is permitted under MAMMOTH's policy rules.
 * Returns a decision — does not throw. Callers decide whether to hard-block or log.
 *
 * Prefer enforceOutputPolicy() for post-execute enforcement in BaseAgent.
 * This function is for pre-dispatch checks in the agent worker and API layer.
 *
 * @param ctx - The action being evaluated
 */
export function evaluateActionPolicy(ctx: PolicyContext): PolicyDecision {
  // Finance is read-only by architecture
  if (ctx.department === "finance") {
    return {
      allowed: false,
      reason: `Finance is read-only. Action "${ctx.actionType}" cannot be dispatched from finance.`,
    };
  }

  // Permanently blocked at the architecture level — no override path
  if (PERMANENTLY_BLOCKED.has(ctx.actionType)) {
    return {
      allowed: false,
      reason: `Action "${ctx.actionType}" is permanently blocked.`,
    };
  }

  // ALWAYS_RING_3 actions must have ring 3 — catch misconfigured callers
  if (ALWAYS_RING_3.has(ctx.actionType) && ctx.ringLevel < 3) {
    return {
      allowed: false,
      reason: `Action "${ctx.actionType}" requires Ring 3. Presented ring: ${ctx.ringLevel}.`,
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
      reason: `Daily cost cap exceeded. Cap: $${MAX_DAILY_COST_USD}, used: $${ctx.dailyCostSoFarUsd.toFixed(2)}.`,
    };
  }

  return { allowed: true, reason: "Policy check passed." };
}

/**
 * Asserts that the ring level assigned to an action is valid per policy.
 * Throws immediately on violation — use this inside createApproval() to catch
 * agents that try to assign wrong ring levels to pinned actions.
 *
 * @param actionType - The action type being approved
 * @param ringLevel  - The ring level the agent requested
 */
export function assertRingLevelValid(
  actionType: string,
  ringLevel: 1 | 2 | 3
): void {
  if (ALWAYS_RING_3.has(actionType) && ringLevel < 3) {
    throw new Error(
      `Policy violation: "${actionType}" must be Ring 3. Attempted: Ring ${ringLevel}.`
    );
  }
  if (PERMANENTLY_BLOCKED.has(actionType)) {
    throw new Error(
      `Policy violation: "${actionType}" is permanently blocked and cannot be approved.`
    );
  }
}
