// Pure MRR calculation functions — no side effects, no DB access.
// These are easy to unit-test because they take plain objects and return numbers.

/**
 * What kind of revenue change this invoice represents.
 * - new_subscription: customer paying for the first time
 * - renewal:          recurring charge with no plan change
 * - expansion:        customer upgraded to a more expensive plan
 * - contraction:      customer downgraded to a cheaper plan
 */
export type MrrChangeType =
  | "new_subscription"
  | "renewal"
  | "expansion"
  | "contraction";

export type MrrDelta = {
  /** Monthly recurring revenue in cents. Always positive. */
  monthlyCents: number;
  changeType: MrrChangeType;
};

type StripeLineItem = {
  plan?: {
    interval: "month" | "year" | "week" | "day";
    interval_count: number;
  };
  amount: number; // in cents
  quantity?: number;
};

type StripeInvoice = {
  /** Amount successfully collected, in cents */
  amount_paid: number;
  /** Whether this is the customer's first invoice (not a renewal) */
  billing_reason?: string;
  lines: {
    data: StripeLineItem[];
  };
};

/**
 * Calculates monthly MRR from a paid Stripe invoice.
 * Converts annual or weekly plans to a monthly equivalent.
 *
 * Example: A $1,200/year plan = $100/month MRR.
 *
 * @param invoice - The Stripe Invoice object from a payment_succeeded event
 * @returns MrrDelta with the monthly amount and change type
 */
export function calculateMrrFromInvoice(invoice: StripeInvoice): MrrDelta {
  let monthlyCents = 0;

  for (const line of invoice.lines.data) {
    const lineCents = line.amount * (line.quantity ?? 1);
    monthlyCents += normalizeToMonthly(lineCents, line.plan);
  }

  const changeType = resolveChangeType(invoice.billing_reason);

  return { monthlyCents, changeType };
}

/**
 * Converts a line item amount to its monthly equivalent.
 * A $1,200 annual charge becomes $100/month.
 * A $25/week charge becomes ~$108/month (25 * 52 / 12).
 */
function normalizeToMonthly(
  amountCents: number,
  plan?: StripeLineItem["plan"]
): number {
  if (!plan) return amountCents;

  const { interval, interval_count } = plan;

  switch (interval) {
    case "month":
      // interval_count=1 → monthly, interval_count=3 → quarterly (divide by 3)
      return Math.round(amountCents / interval_count);

    case "year":
      return Math.round(amountCents / (12 * interval_count));

    case "week":
      // 52 weeks / 12 months ≈ 4.333 weeks per month
      return Math.round((amountCents * 52) / (12 * interval_count));

    case "day":
      return Math.round((amountCents * 365) / (12 * interval_count));

    default:
      return amountCents;
  }
}

/**
 * Maps Stripe's billing_reason to a human-readable change type.
 * Stripe billing reasons: subscription_create, subscription_cycle, subscription_update, etc.
 */
function resolveChangeType(billingReason?: string): MrrChangeType {
  if (!billingReason) return "renewal";

  if (billingReason === "subscription_create") return "new_subscription";
  if (billingReason === "subscription_cycle") return "renewal";
  if (billingReason === "subscription_update") return "expansion"; // could also be contraction — caller must check

  return "renewal";
}

/**
 * Calculates MRR lost when a subscription is cancelled.
 * Returns a negative delta to subtract from today's metrics.
 *
 * @param subscriptionAmountCents - The recurring charge amount in cents
 * @param interval - The billing interval from the subscription's plan
 * @param intervalCount - How many intervals per period (e.g. 3 for quarterly)
 */
export function calculateChurnedMrr(
  subscriptionAmountCents: number,
  interval: "month" | "year" | "week" | "day",
  intervalCount: number
): number {
  return normalizeToMonthly(subscriptionAmountCents, { interval, interval_count: intervalCount });
}

/**
 * Calculates MRR expansion or contraction from a subscription plan change.
 * Returns a positive number for expansion (upgrade) or negative for contraction (downgrade).
 *
 * @param previousAmountCents - The monthly MRR before the change
 * @param newAmountCents      - The monthly MRR after the change
 */
export function calculateSubscriptionChangeDelta(
  previousMonthlyCents: number,
  newMonthlyCents: number
): { deltaCents: number; changeType: "expansion" | "contraction" } {
  const deltaCents = newMonthlyCents - previousMonthlyCents;
  return {
    deltaCents,
    changeType: deltaCents >= 0 ? "expansion" : "contraction",
  };
}
