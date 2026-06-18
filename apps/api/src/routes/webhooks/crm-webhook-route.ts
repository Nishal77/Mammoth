import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Connection, Client } from "@temporalio/client";
import { defineSignal } from "@temporalio/workflow";
import { createLogger } from "@mammoth/observability/logger";
import { db, leads, integrations } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";

// Mirror of the signal defined in workers/temporal/src/workflows/sales-cycle-workflow.ts
// Temporal matches by name ("leadResponded") — the definition must match exactly.
const leadRespondedSignal = defineSignal<[string]>("leadResponded");

const log = createLogger("crm-webhook");

const TEMPORAL_ADDRESS = process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
const TEMPORAL_TASK_QUEUE = "mammoth-sales";

/**
 * HubSpot contact.reply event schema.
 * HubSpot sends an array of subscription events per webhook call.
 */
const HubSpotEventSchema = z.object({
  subscriptionType: z.string(),
  objectId: z.number().optional(),   // HubSpot contact ID
  propertyName: z.string().optional(),
  propertyValue: z.string().optional(),
  portalId: z.number(),
  appId: z.number().optional(),
  occurredAt: z.number(),            // Unix ms
});

const HubSpotWebhookBodySchema = z.array(HubSpotEventSchema);

const CompanyQuerySchema = z.object({
  companyId: z.string().uuid("companyId must be a valid UUID"),
});

/**
 * CRM webhook — receives HubSpot events and fires Temporal signals.
 *
 * When a prospect replies to an outreach email, HubSpot fires a webhook.
 * This handler:
 *   1. Validates the event is a reply/contact event
 *   2. Looks up the lead in our DB by HubSpot contact ID
 *   3. Finds the active Temporal sales cycle for that company+lead
 *   4. Sends the leadRespondedSignal to stop the follow-up sequence
 *
 * Webhook URL configured in HubSpot:
 *   POST https://your-api.mammoth.ai/api/v1/webhooks/crm?companyId={companyId}
 *
 * Subscription types that indicate a reply:
 *   - contact.propertyChange (property: "hs_email_last_reply_date")
 *   - contact.propertyChange (property: "notes_last_contacted")
 */
export async function crmWebhookRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Querystring: { companyId: string }; Body: unknown }>(
    "/webhooks/crm",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["companyId"],
          properties: { companyId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const queryParsed = CompanyQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.status(400).send({ error: "Invalid companyId", code: "INVALID_QUERY" });
      }

      const { companyId } = queryParsed.data;

      // HubSpot can send 1-100 events per webhook call
      const bodyParsed = HubSpotWebhookBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        log.warn("CRM webhook body parse failed", {
          companyId,
          error: bodyParsed.error.message,
        });
        // Return 200 to prevent HubSpot retry storms on malformed payloads
        return reply.status(200).send({ ok: true });
      }

      // Only care about events that indicate a contact replied
      const replyEvents = bodyParsed.data.filter(
        (event) =>
          event.subscriptionType === "contact.propertyChange" &&
          (event.propertyName === "hs_email_last_reply_date" ||
            event.propertyName === "notes_last_contacted")
      );

      if (replyEvents.length === 0) {
        return reply.status(200).send({ ok: true, signalsfired: 0 });
      }

      // Verify this company has HubSpot connected
      const integration = await db.query.integrations.findFirst({
        where: and(
          eq(integrations.companyId, companyId),
          eq(integrations.provider, "hubspot"),
          eq(integrations.status, "connected")
        ),
        columns: { id: true },
      });

      if (!integration) {
        log.warn("CRM webhook received for company without HubSpot integration", { companyId });
        return reply.status(200).send({ ok: true, signalsfired: 0 });
      }

      let signalsFireAttempted = 0;

      const temporalConnection = await Connection.connect({ address: TEMPORAL_ADDRESS });
      const temporalClient = new Client({ connection: temporalConnection, namespace: "default" });

      try {
        for (const event of replyEvents) {
          if (!event.objectId) continue;

          // Look up our internal lead by HubSpot contact ID
          const lead = await db.query.leads.findFirst({
            where: and(
              eq(leads.companyId, companyId),
              eq(leads.externalId, String(event.objectId))
            ),
            columns: { id: true },
          });

          if (!lead) {
            log.warn("CRM webhook: no lead found for HubSpot contact", {
              companyId,
              hubspotContactId: event.objectId,
            });
            continue;
          }

          // Temporal workflow ID follows the convention set in sales-cycle-workflow.ts
          const workflowId = `sales-cycle:${companyId}`;

          try {
            const workflowHandle = temporalClient.workflow.getHandle(workflowId);
            await workflowHandle.signal(leadRespondedSignal, lead.id);

            log.info("leadResponded signal fired", {
              companyId,
              leadId: lead.id,
              hubspotContactId: event.objectId,
              workflowId,
            });

            signalsFireAttempted++;
          } catch (signalErr: unknown) {
            // Workflow may have already completed — not an error worth alerting on
            const msg = signalErr instanceof Error ? signalErr.message : String(signalErr);
            if (!msg.includes("not found") && !msg.includes("completed")) {
              log.warn("Failed to send leadResponded signal", {
                companyId,
                leadId: lead.id,
                workflowId,
                error: msg,
              });
            }
          }
        }
      } finally {
        await temporalConnection.close();
      }

      return reply.status(200).send({ ok: true, signalsFireAttempted });
    }
  );
}
