import { describe, it, expect } from "vitest";
import {
  calculateMrrFromInvoice,
  calculateChurnedMrr,
  calculateSubscriptionChangeDelta,
} from "./mrr-calculator.ts";

describe("calculateMrrFromInvoice", () => {
  it("handles a simple monthly subscription", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 9900, // $99.00
      billing_reason: "subscription_cycle",
      lines: {
        data: [
          {
            plan: { interval: "month", interval_count: 1 },
            amount: 9900,
            quantity: 1,
          },
        ],
      },
    });

    expect(result.monthlyCents).toBe(9900);
    expect(result.changeType).toBe("renewal");
  });

  it("converts annual plan to monthly equivalent", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 118800, // $1,188/year → $99/month
      billing_reason: "subscription_create",
      lines: {
        data: [
          {
            plan: { interval: "year", interval_count: 1 },
            amount: 118800,
            quantity: 1,
          },
        ],
      },
    });

    expect(result.monthlyCents).toBe(9900); // 118800 / 12 = 9900
    expect(result.changeType).toBe("new_subscription");
  });

  it("handles quarterly billing (interval_count=3)", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 29700, // $297/quarter → $99/month
      billing_reason: "subscription_cycle",
      lines: {
        data: [
          {
            plan: { interval: "month", interval_count: 3 },
            amount: 29700,
          },
        ],
      },
    });

    expect(result.monthlyCents).toBe(9900); // 29700 / 3 = 9900
  });

  it("handles weekly billing interval", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 2300,
      billing_reason: "subscription_cycle",
      lines: {
        data: [
          {
            plan: { interval: "week", interval_count: 1 },
            amount: 2300,
          },
        ],
      },
    });

    // 2300 * 52 / 12 ≈ 9967
    expect(result.monthlyCents).toBeCloseTo(9967, -2);
  });

  it("adds up multiple line items", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 14900,
      billing_reason: "subscription_cycle",
      lines: {
        data: [
          {
            plan: { interval: "month", interval_count: 1 },
            amount: 9900,
            quantity: 1,
          },
          {
            plan: { interval: "month", interval_count: 1 },
            amount: 5000,
            quantity: 1,
          },
        ],
      },
    });

    expect(result.monthlyCents).toBe(14900);
  });

  it("respects quantity multiplier", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 29700,
      billing_reason: "subscription_cycle",
      lines: {
        data: [
          {
            plan: { interval: "month", interval_count: 1 },
            amount: 9900,
            quantity: 3,
          },
        ],
      },
    });

    expect(result.monthlyCents).toBe(29700);
  });

  it("marks subscription_create as new_subscription", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 9900,
      billing_reason: "subscription_create",
      lines: {
        data: [{ plan: { interval: "month", interval_count: 1 }, amount: 9900 }],
      },
    });
    expect(result.changeType).toBe("new_subscription");
  });

  it("marks subscription_update as expansion", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 29900,
      billing_reason: "subscription_update",
      lines: {
        data: [{ plan: { interval: "month", interval_count: 1 }, amount: 29900 }],
      },
    });
    expect(result.changeType).toBe("expansion");
  });

  it("defaults to renewal for unknown billing_reason", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 9900,
      billing_reason: "manual",
      lines: {
        data: [{ plan: { interval: "month", interval_count: 1 }, amount: 9900 }],
      },
    });
    expect(result.changeType).toBe("renewal");
  });

  it("handles no billing_reason (undefined)", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 9900,
      lines: {
        data: [{ plan: { interval: "month", interval_count: 1 }, amount: 9900 }],
      },
    });
    expect(result.changeType).toBe("renewal");
    expect(result.monthlyCents).toBe(9900);
  });

  it("handles a line item with no plan (one-time charge)", () => {
    const result = calculateMrrFromInvoice({
      amount_paid: 5000,
      lines: {
        data: [{ amount: 5000 }], // no plan attached
      },
    });
    // Falls through to raw amount since no plan is present
    expect(result.monthlyCents).toBe(5000);
  });
});

describe("calculateChurnedMrr", () => {
  it("returns monthly equivalent for a monthly subscription", () => {
    expect(calculateChurnedMrr(9900, "month", 1)).toBe(9900);
  });

  it("converts annual amount to monthly", () => {
    expect(calculateChurnedMrr(118800, "year", 1)).toBe(9900);
  });

  it("converts quarterly to monthly", () => {
    expect(calculateChurnedMrr(29700, "month", 3)).toBe(9900);
  });
});

describe("calculateSubscriptionChangeDelta", () => {
  it("positive delta = expansion", () => {
    const result = calculateSubscriptionChangeDelta(9900, 29900);
    expect(result.deltaCents).toBe(20000);
    expect(result.changeType).toBe("expansion");
  });

  it("negative delta = contraction", () => {
    const result = calculateSubscriptionChangeDelta(29900, 9900);
    expect(result.deltaCents).toBe(-20000);
    expect(result.changeType).toBe("contraction");
  });

  it("zero delta = expansion (no change)", () => {
    const result = calculateSubscriptionChangeDelta(9900, 9900);
    expect(result.deltaCents).toBe(0);
    expect(result.changeType).toBe("expansion");
  });
});
