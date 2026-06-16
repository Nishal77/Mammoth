import Stripe from "stripe";

// These are MAMMOTH's own Stripe price IDs — not the customer's.
// Set these in environment variables or the Stripe dashboard.
const PRICE_IDS: Record<"growth" | "scale", string | undefined> = {
  growth: process.env["STRIPE_PRICE_GROWTH_MONTHLY"],
  scale: process.env["STRIPE_PRICE_SCALE_MONTHLY"],
};

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env["STRIPE_SECRET_KEY"];
    if (!key) throw new Error("STRIPE_SECRET_KEY is required");
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export type CheckoutSessionResult =
  | { created: true; url: string; sessionId: string }
  | { created: false; reason: string };

export type PortalSessionResult =
  | { created: true; url: string }
  | { created: false; reason: string };

/**
 * Creates a Stripe Checkout Session for a MAMMOTH subscription upgrade.
 * Redirects the customer to Stripe's hosted payment page.
 *
 * After payment, Stripe sends a `checkout.session.completed` webhook which
 * updates the user's plan in our database.
 *
 * @param userId          - MAMMOTH user ID (stored as Stripe metadata for webhook lookup)
 * @param planTier        - Which MAMMOTH plan to subscribe to ("growth" | "scale")
 * @param customerEmail   - Pre-fills the Stripe Checkout email field
 * @param successUrl      - Where to redirect after successful payment
 * @param cancelUrl       - Where to redirect if the customer cancels
 * @param stripeCustomerId - Existing Stripe customer ID (pass if the user already has one)
 */
export async function createCheckoutSession(options: {
  userId: string;
  planTier: "growth" | "scale";
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  stripeCustomerId?: string | null;
}): Promise<CheckoutSessionResult> {
  const { userId, planTier, customerEmail, successUrl, cancelUrl, stripeCustomerId } = options;

  const priceId = PRICE_IDS[planTier];
  if (!priceId) {
    return {
      created: false,
      reason: `STRIPE_PRICE_${planTier.toUpperCase()}_MONTHLY is not configured`,
    };
  }

  try {
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { mammothUserId: userId, mammothPlanTier: planTier },
    };

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId;
    } else {
      sessionParams.customer_email = customerEmail;
    }

    const session = await getStripe().checkout.sessions.create(sessionParams);

    if (!session.url) {
      return { created: false, reason: "Stripe did not return a checkout URL" };
    }

    return { created: true, url: session.url, sessionId: session.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Stripe error";
    return { created: false, reason };
  }
}

/**
 * Creates a Stripe Customer Portal session.
 * Lets the customer manage their subscription, update payment methods, or cancel.
 *
 * @param stripeCustomerId - The customer's Stripe ID
 * @param returnUrl        - Where to send the customer when they're done in the portal
 */
export async function createPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<PortalSessionResult> {
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return { created: true, url: session.url };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Stripe portal error";
    return { created: false, reason };
  }
}

/**
 * Processes Stripe billing webhooks for MAMMOTH's own subscription system.
 * Updates the user's plan tier based on subscription events.
 *
 * @param rawBody            - Raw request body Buffer (must not be pre-parsed)
 * @param signature          - Value of the stripe-signature header
 * @param billingWebhookSecret - MAMMOTH's own billing webhook secret
 * @returns The processed event type, or null if the event was skipped
 */
export async function handleBillingWebhook(
  rawBody: Buffer,
  signature: string,
  billingWebhookSecret: string
): Promise<{ eventType: string } | null> {
  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, billingWebhookSecret);
  } catch {
    throw new Error("Invalid Stripe webhook signature");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await handleCheckoutCompleted(session);
    return { eventType: event.type };
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    await handleSubscriptionCancelled(subscription);
    return { eventType: event.type };
  }

  return null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.["mammothUserId"];
  const planTier = session.metadata?.["mammothPlanTier"];
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;

  if (!userId || !planTier) return;

  const { db, users, companies } = await import("@mammoth/db");
  const { eq } = await import("drizzle-orm");

  // Update the user's plan
  await db
    .update(users)
    .set({ plan: planTier as "growth" | "scale", updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Store the Stripe customer ID on all companies owned by this user
  if (stripeCustomerId) {
    await db
      .update(companies)
      .set({ stripeCustomerId, updatedAt: new Date() })
      .where(eq(companies.ownerId, userId));
  }
}

async function handleSubscriptionCancelled(subscription: Stripe.Subscription): Promise<void> {
  const stripeCustomerId =
    typeof subscription.customer === "string" ? subscription.customer : null;

  if (!stripeCustomerId) return;

  const { db, companies, users } = await import("@mammoth/db");
  const { eq } = await import("drizzle-orm");

  // Find the company by Stripe customer ID
  const company = await db.query.companies.findFirst({
    where: eq(companies.stripeCustomerId, stripeCustomerId),
    columns: { ownerId: true },
  });

  if (!company) return;

  // Downgrade user to free plan
  await db
    .update(users)
    .set({ plan: "free", updatedAt: new Date() })
    .where(eq(users.id, company.ownerId));
}
