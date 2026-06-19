import { describe, it, expect } from "vitest";
import { enforceOutputPolicy, type PolicyCheckableOutput } from "./ring-enforcer.js";
import { PolicyViolationError } from "./policy-violation-error.js";

function makeOutput(overrides: Partial<PolicyCheckableOutput> = {}): PolicyCheckableOutput {
  return {
    actionType: "send_email_campaign",
    ringLevel: 1,
    approvalRequired: false,
    content: "Email content",
    summary: {},
    confidence: 0.9,
    ...overrides,
  };
}

describe("enforceOutputPolicy() — Rule 1: permanently blocked", () => {
  it("throws PolicyViolationError for push_to_main", () => {
    expect(() =>
      enforceOutputPolicy(makeOutput({ actionType: "push_to_main" }), "engineering")
    ).toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError for drop_database", () => {
    expect(() =>
      enforceOutputPolicy(makeOutput({ actionType: "drop_database" }), "engineering")
    ).toThrow(PolicyViolationError);
  });

  it("includes policyCode PERMANENTLY_BLOCKED on the error", () => {
    try {
      enforceOutputPolicy(makeOutput({ actionType: "revoke_founder_access" }), "hr");
    } catch (err) {
      expect(err instanceof PolicyViolationError).toBe(true);
      expect((err as PolicyViolationError).policyCode).toBe("PERMANENTLY_BLOCKED");
    }
  });
});

describe("enforceOutputPolicy() — Rule 2: finance read-only", () => {
  it("escalates non-allowlisted finance action to Ring 3", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "send_email_campaign", ringLevel: 1, approvalRequired: false }),
      "finance"
    );
    expect(result.ringLevel).toBe(3);
    expect(result.approvalRequired).toBe(true);
    expect(result._policyCorrections).toHaveLength(1);
  });

  it("keeps allowlisted finance action but bumps Ring 1 to Ring 2", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "generate_financial_report", ringLevel: 1, approvalRequired: false }),
      "finance"
    );
    expect(result.ringLevel).toBe(2);
    expect(result.approvalRequired).toBe(true);
  });

  it("does not modify allowlisted finance action at Ring 2", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "calculate_burn_rate", ringLevel: 2, approvalRequired: true }),
      "finance"
    );
    expect(result.ringLevel).toBe(2);
    expect(result._policyCorrections).toHaveLength(0);
  });
});

describe("enforceOutputPolicy() — Rule 3: ALWAYS_RING_3 actions", () => {
  it("escalates send_offer_letter from Ring 1 to Ring 3", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "send_offer_letter", ringLevel: 1, approvalRequired: false }),
      "hr"
    );
    expect(result.ringLevel).toBe(3);
    expect(result.approvalRequired).toBe(true);
  });

  it("escalates initiate_voice_call from Ring 2 to Ring 3", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "initiate_voice_call", ringLevel: 2, approvalRequired: true }),
      "sales"
    );
    expect(result.ringLevel).toBe(3);
    expect(result.approvalRequired).toBe(true);
    expect(result._policyCorrections.some((c) => c.field === "ringLevel")).toBe(true);
  });

  it("does not modify send_offer_letter already at Ring 3", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "send_offer_letter", ringLevel: 3, approvalRequired: true }),
      "hr"
    );
    expect(result._policyCorrections).toHaveLength(0);
  });
});

describe("enforceOutputPolicy() — Rule 4: Ring ≥ 2 requires approvalRequired: true", () => {
  it("fixes Ring 2 with approvalRequired: false", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "post_to_linkedin", ringLevel: 2, approvalRequired: false }),
      "marketing"
    );
    expect(result.approvalRequired).toBe(true);
    expect(result._policyCorrections.some((c) => c.field === "approvalRequired")).toBe(true);
  });
});

describe("enforceOutputPolicy() — Rule 5: Ring 1 requires approvalRequired: false", () => {
  it("fixes Ring 1 with approvalRequired: true", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "send_email_campaign", ringLevel: 1, approvalRequired: true }),
      "marketing"
    );
    expect(result.approvalRequired).toBe(false);
    expect(result._policyCorrections.some((c) => c.field === "approvalRequired")).toBe(true);
  });
});

describe("enforceOutputPolicy() — clean output pass-through", () => {
  it("returns no corrections for a valid Ring 1 output", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "send_email_campaign", ringLevel: 1, approvalRequired: false }),
      "marketing"
    );
    expect(result._policyCorrections).toHaveLength(0);
    expect(result.ringLevel).toBe(1);
    expect(result.approvalRequired).toBe(false);
  });

  it("returns no corrections for a valid Ring 3 output", () => {
    const result = enforceOutputPolicy(
      makeOutput({ actionType: "schedule_meeting", ringLevel: 3, approvalRequired: true }),
      "sales"
    );
    expect(result._policyCorrections).toHaveLength(0);
  });

  it("preserves content and summary untouched", () => {
    const output = makeOutput({
      content: "My email content",
      summary: { recipientCount: 50 },
      confidence: 0.85,
    });
    const result = enforceOutputPolicy(output, "marketing");
    expect(result.content).toBe("My email content");
    expect(result.summary).toEqual({ recipientCount: 50 });
    expect(result.confidence).toBe(0.85);
  });
});
