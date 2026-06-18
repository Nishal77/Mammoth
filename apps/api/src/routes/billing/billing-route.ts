import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, companies, users } from "@mammoth/memory-database";
import { eq } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import {
  createCheckoutSession,
  createPortalSession,
  handleBillingWebhook,
  getDailyAiCost,
  checkDailyBudget,
} from "@mammoth/tool-billing";

const BILLING_WEBHOOK_SECRET = process.env["STRIPE_BILLING_WEBHOOK_SECRET"];
const APP_URL = process.env["APP_URL"] ?? "http://localhost:3000";

const createCheckoutSchema = z.object({
  planTier: z.enum(["growth", "scale"]),
  companyId: z.string().uuid("companyId must be a UUID"),
});

/**
 * Billing routes for MAMMOTH's own subscription system.
 * Handles checkout, customer portal, usage stats, and Stripe billing webhooks.
 * Prefix: /api/v1/billing
 */
export async function billingRoute(app: FastifyInstance): Promise<void> {
  // Create a Stripe Checkout Session (starts the subscription flow)
  app.post(
    "/checkout",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = createCheckoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid input",
          code: "VALIDATION_ERROR",
        });
      }

      const { planTier, companyId } = parsed.data;

      const company = await db.query.companies.findFirst({
        where: eq(companies.id, companyId),
        columns: { stripeCustomerId: true, ownerId: true },
      });

      if (!company) {
        return reply.status(404).send({ error: "Company not found", code: "NOT_FOUND" });
      }

      const result = await createCheckoutSession({
        userId: company.ownerId,
        planTier,
        customerEmail: request.user.email,
        successUrl: `${APP_URL}/dashboard?billing=success`,
        cancelUrl: `${APP_URL}/dashboard/settings/billing?billing=cancelled`,
        stripeCustomerId: company.stripeCustomerId,
      });

      if (!result.created) {
        return reply.status(500).send({ error: result.reason, code: "CHECKOUT_FAILED" });
      }

      return reply.send({ data: { url: result.url, sessionId: result.sessionId } });
    }
  );

  // Create a Stripe Customer Portal Session (manage existing subscription)
  app.post(
    "/portal",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { companyId } = request.body as { companyId?: string };

      if (!companyId) {
        return reply.status(400).send({ error: "companyId is required", code: "VALIDATION_ERROR" });
      }

      const company = await db.query.companies.findFirst({
        where: eq(companies.id, companyId),
        columns: { stripeCustomerId: true },
      });

      if (!company?.stripeCustomerId) {
        return reply.status(404).send({
          error: "No active subscription found. Subscribe first to access the billing portal.",
          code: "NO_SUBSCRIPTION",
        });
      }

      const result = await createPortalSession(
        company.stripeCustomerId,
        `${APP_URL}/dashboard/settings/billing`
      );

      if (!result.created) {
        return reply.status(500).send({ error: result.reason, code: "PORTAL_FAILED" });
      }

      return reply.send({ data: { url: result.url } });
    }
  );

  // Get current plan and daily usage stats
  app.get(
    "/status",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const companyId = (request.query as { companyId?: string }).companyId;

      if (!companyId) {
        return reply.status(400).send({ error: "companyId query param required", code: "VALIDATION_ERROR" });
      }

      const owner = await db.query.users.findFirst({
        where: eq(users.id, request.user.id),
        columns: { plan: true },
      });

      const [dailyCost, budgetCheck] = await Promise.all([
        getDailyAiCost(companyId),
        checkDailyBudget(companyId),
      ]);

      return reply.send({
        data: {
          plan: owner?.plan ?? "free",
          dailyAiCostUsd: dailyCost,
          budgetAllowed: budgetCheck.allowed,
          remainingUsd: budgetCheck.allowed ? budgetCheck.remainingUsd : 0,
        },
      });
    }
  );

  // Stripe billing webhook in a scoped sub-plugin.
  // The raw body content-type parser is scoped here so it doesn't affect JSON routes above.
  await app.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => {
        done(null, body);
      }
    );

    webhookScope.post(
      "/webhook",
      async (request, reply) => {
        if (!BILLING_WEBHOOK_SECRET) {
          request.log.error("STRIPE_BILLING_WEBHOOK_SECRET is not configured");
          return reply.status(500).send({
            error: "Billing webhook not configured",
            code: "CONFIG_ERROR",
          });
        }

        const signature = request.headers["stripe-signature"];
        if (!signature || typeof signature !== "string") {
          return reply.status(400).send({
            error: "Missing stripe-signature header",
            code: "MISSING_SIGNATURE",
          });
        }

        const rawBody = request.body as Buffer;

        try {
          const result = await handleBillingWebhook(rawBody, signature, BILLING_WEBHOOK_SECRET);
          return reply.send({
            received: true,
            eventType: result?.eventType ?? "skipped",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Webhook processing failed";
          request.log.warn({ message }, "Billing webhook error");
          return reply.status(400).send({ error: message, code: "WEBHOOK_ERROR" });
        }
      }
    );
  });
}
