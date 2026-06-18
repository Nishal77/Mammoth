import Stripe from "stripe";
import { db, metricsDaily } from "@mammoth/memory-database";
import { and, eq, sql } from "drizzle-orm";
import {
  calculateMrrFromInvoice,
  calculateChurnedMrr,
} from "./mrr-calculator.ts";

// Reuse a single Stripe client across invocations
let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const secretKey = process.env["STRIPE_SECRET_KEY"];
    if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required");
    stripeClient = new Stripe(secretKey);
  }
  return stripeClient;
}

/**
 * Result of processing a Stripe webhook event.
 * Callers use this to return an appropriate HTTP response.
 */
export type WebhookResult =
  | { status: "processed"; eventType: string }
  | { status: "skipped"; eventType: string; reason: string }
  | { status: "error"; message: string };

/**
 * Verifies a Stripe webhook signature and processes the event.
 * Must receive the raw request body (not parsed JSON) for signature verification.
 *
 * How the company is identified:
 * - The webhook URL is `POST /api/v1/webhooks/stripe?companyId=xxx`
 * - Each company registers their own Stripe webhook using their unique URL
 * - They also provide their webhook signing secret, stored in their integration row
 *
 * @param rawBody       - Raw request body as a Buffer (do NOT parse as JSON first)
 * @param signature     - Value of the `stripe-signature` header
 * @param webhookSecret - The company's Stripe webhook signing secret
 * @param companyId     - The MAMMOTH company this webhook belongs to
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string,
  webhookSecret: string,
  companyId: string
): Promise<WebhookResult> {
  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signature verification failed";
    return { status: "error", message };
  }

  try {
    switch (event.type) {
      case "invoice.payment_succeeded":
        await processInvoicePaid(event.data.object as Stripe.Invoice, companyId);
        break;

      case "customer.subscription.deleted":
        await processSubscriptionCancelled(event.data.object as Stripe.Subscription, companyId);
        break;

      default:
        return {
          status: "skipped",
          eventType: event.type,
          reason: "Event type not handled",
        };
    }

    return { status: "processed", eventType: event.type };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    return { status: "error", message };
  }
}

/**
 * Handles a successful invoice payment.
 * Upserts today's metrics_daily row with the new MRR.
 * Uses INSERT ... ON CONFLICT to safely handle duplicate webhook deliveries.
 */
async function processInvoicePaid(
  invoice: Stripe.Invoice,
  companyId: string
): Promise<void> {
  // Build line items — conditionally include `plan` to satisfy exactOptionalPropertyTypes
  const lineItems = invoice.lines.data.map((line) => {
    const item: {
      amount: number;
      quantity: number;
      plan?: { interval: "month" | "year" | "week" | "day"; interval_count: number };
    } = { amount: line.amount, quantity: line.quantity ?? 1 };

    if (line.plan) {
      item.plan = {
        interval: line.plan.interval as "month" | "year" | "week" | "day",
        interval_count: line.plan.interval_count,
      };
    }
    return item;
  });

  // billing_reason is an optional property — only include it when present
  const invoiceInput: Parameters<typeof calculateMrrFromInvoice>[0] = {
    amount_paid: invoice.amount_paid,
    lines: { data: lineItems },
  };
  if (invoice.billing_reason) {
    invoiceInput.billing_reason = invoice.billing_reason;
  }

  const { monthlyCents, changeType } = calculateMrrFromInvoice(invoiceInput);
  const mrr = (monthlyCents / 100).toFixed(2);
  const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Upsert: if today's row already exists, add the MRR (multiple subscriptions per day)
  await db
    .insert(metricsDaily)
    .values({
      companyId,
      date: todayStr,
      mrr,
      arr: ((monthlyCents * 12) / 100).toFixed(2),
      newMrr: changeType === "new_subscription" ? mrr : "0",
      expansionMrr: changeType === "expansion" ? mrr : "0",
    })
    .onConflictDoUpdate({
      target: [metricsDaily.companyId, metricsDaily.date],
      set: {
        mrr: sql`${metricsDaily.mrr}::numeric + ${mrr}::numeric`,
        arr: sql`(${metricsDaily.mrr}::numeric + ${mrr}::numeric) * 12`,
        newMrr:
          changeType === "new_subscription"
            ? sql`${metricsDaily.newMrr}::numeric + ${mrr}::numeric`
            : metricsDaily.newMrr,
        expansionMrr:
          changeType === "expansion"
            ? sql`${metricsDaily.expansionMrr}::numeric + ${mrr}::numeric`
            : metricsDaily.expansionMrr,
      },
    });
}

/**
 * Handles a subscription cancellation.
 * Records churned MRR for today's metrics row.
 */
async function processSubscriptionCancelled(
  subscription: Stripe.Subscription,
  companyId: string
): Promise<void> {
  const firstItem = subscription.items.data[0];
  if (!firstItem?.price) return;

  const amountCents = firstItem.price.unit_amount ?? 0;
  const interval = (firstItem.price.recurring?.interval ?? "month") as
    | "month"
    | "year"
    | "week"
    | "day";
  const intervalCount = firstItem.price.recurring?.interval_count ?? 1;

  const churnedMonthlyCents = calculateChurnedMrr(amountCents, interval, intervalCount);
  const churnedMrr = (churnedMonthlyCents / 100).toFixed(2);
  const todayStr = new Date().toISOString().slice(0, 10);

  await db
    .insert(metricsDaily)
    .values({
      companyId,
      date: todayStr,
      churnedMrr,
      churnedCustomers: 1,
    })
    .onConflictDoUpdate({
      target: [metricsDaily.companyId, metricsDaily.date],
      set: {
        churnedMrr: sql`${metricsDaily.churnedMrr}::numeric + ${churnedMrr}::numeric`,
        churnedCustomers: sql`${metricsDaily.churnedCustomers} + 1`,
        mrr: sql`GREATEST(0, ${metricsDaily.mrr}::numeric - ${churnedMrr}::numeric)`,
        arr: sql`GREATEST(0, (${metricsDaily.mrr}::numeric - ${churnedMrr}::numeric) * 12)`,
      },
    });
}

/**
 * Looks up the webhook secret for a company's Stripe integration.
 * Returns null if the company has no active Stripe integration.
 *
 * Used by the webhook route to retrieve the secret before calling handleStripeWebhook.
 */
export async function getStripeWebhookSecret(
  companyId: string
): Promise<string | null> {
  const { integrations } = await import("@mammoth/memory-database");

  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.provider, "stripe"),
      eq(integrations.status, "connected")
    ),
    columns: { metadata: true },
  });

  if (!integration?.metadata) return null;

  // metadata is stored as a JSON string in the text column
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(integration.metadata) as Record<string, unknown>;
  } catch {
    return null;
  }
  const secret = meta["webhookSecret"];

  return typeof secret === "string" ? secret : null;
}
