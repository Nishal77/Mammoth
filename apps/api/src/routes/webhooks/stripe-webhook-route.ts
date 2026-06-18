import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  handleStripeWebhook,
  getStripeWebhookSecret,
} from "@mammoth/tool-billing";

const companyIdSchema = z.object({
  companyId: z.string().uuid("companyId must be a valid UUID"),
});

/**
 * Stripe webhook endpoint for MAMMOTH companies' own Stripe data (MRR tracking).
 *
 * Each company registers their own Stripe webhook pointing to:
 *   POST /api/v1/webhooks/stripe?companyId=<their-mammoth-company-id>
 *
 * They also save their webhook signing secret in the MAMMOTH integrations page.
 * This endpoint verifies the signature against that saved secret before processing.
 *
 * IMPORTANT: Fastify must NOT parse the body as JSON — Stripe requires the raw
 * bytes for signature verification. The content type parser below handles this.
 */
export async function stripeWebhookRoute(app: FastifyInstance): Promise<void> {
  // Register a raw body parser for Stripe's content type.
  // This overrides the default JSON parser only for this plugin scope.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    }
  );

  app.post<{ Querystring: { companyId?: string } }>(
    "/stripe",
    {},
    async (request, reply) => {
      // Validate companyId query param
      const queryParse = companyIdSchema.safeParse(request.query);
      if (!queryParse.success) {
        return reply.status(400).send({
          error: "companyId query parameter is required and must be a UUID",
          code: "INVALID_COMPANY_ID",
        });
      }

      const { companyId } = queryParse.data;

      // Look up the webhook secret the company saved during integration setup
      const webhookSecret = await getStripeWebhookSecret(companyId);
      if (!webhookSecret) {
        return reply.status(400).send({
          error: "No Stripe integration found for this company",
          code: "INTEGRATION_NOT_FOUND",
        });
      }

      const signature = request.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return reply.status(400).send({
          error: "Missing stripe-signature header",
          code: "MISSING_SIGNATURE",
        });
      }

      // The body is a Buffer because we registered a raw content type parser above
      const rawBody = request.body as Buffer;

      const result = await handleStripeWebhook(
        rawBody,
        signature,
        webhookSecret,
        companyId
      );

      if (result.status === "error") {
        request.log.warn(
          { companyId, message: result.message },
          "Stripe webhook processing failed"
        );
        return reply.status(400).send({
          error: result.message,
          code: "WEBHOOK_ERROR",
        });
      }

      if (result.status === "skipped") {
        request.log.debug(
          { companyId, eventType: result.eventType, reason: result.reason },
          "Stripe webhook skipped"
        );
      }

      // Always return 200 to Stripe — even for skipped events.
      // Returning non-2xx causes Stripe to retry, which we don't want for unsupported events.
      return reply.send({ received: true, eventType: result.eventType });
    }
  );
}
