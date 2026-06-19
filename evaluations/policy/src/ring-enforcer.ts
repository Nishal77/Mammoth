import {
  ALWAYS_RING_3,
  PERMANENTLY_BLOCKED,
  FINANCE_READ_ONLY_ACTIONS,
} from "./policy-constants.js";
import { PolicyViolationError } from "./policy-violation-error.js";

/**
 * DB-sourced runtime additions to ALWAYS_RING_3 and PERMANENTLY_BLOCKED.
 * Loaded by BaseAgent from policy-rules-cache every 5 minutes.
 * Cannot remove hardcoded defaults — only extends them.
 */
export type PolicyRuleOverrides = {
  alwaysRing3Extra: ReadonlySet<string>;
  permanentlyBlockedExtra: ReadonlySet<string>;
};

/**
 * Minimal shape the enforcer needs from any agent output.
 * Defined here to avoid a circular dep with @mammoth/agent-base.
 */
export type PolicyCheckableOutput = {
  actionType: string;
  ringLevel: 1 | 2 | 3;
  approvalRequired: boolean;
  content: string;
  summary: Record<string, unknown>;
  confidence: number;
};

export type PolicyCorrection = {
  field: "ringLevel" | "approvalRequired";
  from: unknown;
  to: unknown;
  rule: string;
};

export type PolicyEnforcedOutput = PolicyCheckableOutput & {
  _policyCorrections: PolicyCorrection[];
};

/**
 * Enforces all ring-level and department-scope rules against an agent's output.
 * Pure function — no DB, no side effects, deterministic.
 *
 * Called by BaseAgent.run() after execute() and before the eval gate.
 * New agents extending BaseAgent automatically get this enforcement for free.
 *
 * Throws PolicyViolationError only for PERMANENTLY_BLOCKED actions (programming
 * errors that must never reach dispatch). All other violations are silently
 * corrected and returned in _policyCorrections for the caller to audit-log.
 *
 * @param output     - Raw output from the agent's execute()
 * @param department - Lowercase department name (e.g. "finance", "sales")
 * @returns Corrected output with _policyCorrections list
 */
export function enforceOutputPolicy(
  output: PolicyCheckableOutput,
  department: string,
  ruleOverrides?: PolicyRuleOverrides
): PolicyEnforcedOutput {
  const corrections: PolicyCorrection[] = [];
  let { ringLevel, approvalRequired } = output;

  // ── Rule 1: Permanently blocked — hard throw ──────────────────────────────
  // These actions cannot be dispatched by any department under any ring.
  // The worker must dead-letter this job — never retry.
  const isPermBlocked =
    PERMANENTLY_BLOCKED.has(output.actionType) ||
    (ruleOverrides?.permanentlyBlockedExtra.has(output.actionType) ?? false);

  if (isPermBlocked) {
    throw new PolicyViolationError(
      `Action "${output.actionType}" is permanently blocked. No ring or approval can authorize it.`,
      "PERMANENTLY_BLOCKED"
    );
  }

  // ── Rule 2: Finance read-only constraint ──────────────────────────────────
  // Finance has no write tools by architecture. Any output type not in the
  // allowed read-only set (reports, calculations) escalates to Ring 3.
  if (department === "finance") {
    if (!FINANCE_READ_ONLY_ACTIONS.has(output.actionType)) {
      const prev = ringLevel;
      ringLevel = 3;
      approvalRequired = true;
      corrections.push({
        field: "ringLevel",
        from: prev,
        to: 3,
        rule: `Finance action "${output.actionType}" not in read-only allowlist. Escalated to Ring 3.`,
      });
    } else if (ringLevel === 1) {
      // Finance allowed actions still cannot auto-execute (minimum Ring 2)
      ringLevel = 2;
      approvalRequired = true;
      corrections.push({
        field: "ringLevel",
        from: 1,
        to: 2,
        rule: "Finance cannot auto-execute (Ring 1). Minimum ring is 2.",
      });
    }
  }

  // ── Rule 3: ALWAYS_RING_3 actions — pinned regardless of trust score ──────
  // The Progressive Trust Engine cannot promote these to Ring 2 or Ring 1.
  const isAlwaysRing3 =
    ALWAYS_RING_3.has(output.actionType) ||
    (ruleOverrides?.alwaysRing3Extra.has(output.actionType) ?? false);

  if (isAlwaysRing3 && ringLevel < 3) {
    const overrideSource = ruleOverrides?.alwaysRing3Extra.has(output.actionType) ? " (runtime override)" : "";
    corrections.push({
      field: "ringLevel",
      from: ringLevel,
      to: 3,
      rule: `"${output.actionType}" is pinned to Ring 3 by policy${overrideSource}. Trust score cannot override.`,
    });
    ringLevel = 3;
    approvalRequired = true;
  }

  // ── Rule 4: Ring ≥ 2 requires approvalRequired: true ─────────────────────
  // Ring 2 and Ring 3 route through the approval queue. A mismatch here is
  // a bug in the agent's execute() — the action would never get dispatched.
  if (ringLevel >= 2 && !approvalRequired) {
    corrections.push({
      field: "approvalRequired",
      from: false,
      to: true,
      rule: `Ring ${ringLevel} requires approvalRequired: true. Auto-execute only valid at Ring 1.`,
    });
    approvalRequired = true;
  }

  // ── Rule 5: Ring 1 requires approvalRequired: false ───────────────────────
  // Ring 1 auto-executes — no approval queue entry is created. Returning
  // approvalRequired: true with Ring 1 would create a queue entry that never
  // resolves (the veto window only applies to Ring 2). Normalize it.
  if (ringLevel === 1 && approvalRequired) {
    corrections.push({
      field: "approvalRequired",
      from: true,
      to: false,
      rule: "Ring 1 auto-executes. approvalRequired must be false.",
    });
    approvalRequired = false;
  }

  return {
    ...output,
    ringLevel,
    approvalRequired,
    _policyCorrections: corrections,
  };
}
