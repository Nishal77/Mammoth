import type { FastifyInstance, FastifyRequest } from "fastify";
import { db, approvals, users } from "@mammoth/db";
import { eq, and } from "drizzle-orm";
import { NotFoundError, ForbiddenError } from "@mammoth/shared/errors";

type WhatsAppWebhookBody = {
  object: string;
  entry: Array<{
    changes: Array<{
      value: {
        messages?: Array<{
          from: string;
          type: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
};

/**
 * Registers the WhatsApp webhook route.
 * Handles GET (verification) and POST (incoming messages).
 * Incoming messages are parsed for APPROVE/REJECT keyword commands.
 */
export async function whatsappWebhookRoute(
  app: FastifyInstance
): Promise<void> {
  // Meta webhook verification handshake
  app.get(
    "/webhooks/whatsapp",
    async (
      request: FastifyRequest<{
        Querystring: {
          "hub.mode"?: string;
          "hub.verify_token"?: string;
          "hub.challenge"?: string;
        };
      }>,
      reply
    ) => {
      const verifyToken = process.env["META_WHATSAPP_VERIFY_TOKEN"];
      const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } =
        request.query;

      if (mode === "subscribe" && token === verifyToken) {
        return reply.status(200).send(challenge);
      }

      return reply.status(403).send({ error: "Forbidden" });
    }
  );

  app.post(
    "/webhooks/whatsapp",
    async (request: FastifyRequest<{ Body: WhatsAppWebhookBody }>, reply) => {
      const body = request.body;

      if (body.object !== "whatsapp_business_account") {
        return reply.status(400).send();
      }

      for (const entry of body.entry) {
        for (const change of entry.changes) {
          const messages = change.value.messages ?? [];
          for (const message of messages) {
            if (message.type === "text" && message.text) {
              await processWhatsAppCommand(message.from, message.text.body);
            }
          }
        }
      }

      return reply.status(200).send({ status: "ok" });
    }
  );
}

async function processWhatsAppCommand(
  fromPhone: string,
  text: string
): Promise<void> {
  const trimmed = text.trim().toUpperCase();
  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  const approvalId = parts[1];

  if (!command || !approvalId) return;
  if (command !== "APPROVE" && command !== "REJECT") return;

  const user = await db.query.users.findFirst({
    where: eq(users.whatsappPhone, fromPhone),
    columns: { id: true },
  });

  if (!user) return;

  const approval = await db.query.approvals.findFirst({
    where: and(
      eq(approvals.id, approvalId),
      eq(approvals.status, "pending")
    ),
    columns: { id: true, expiresAt: true },
  });

  if (!approval) return;
  if (approval.expiresAt && approval.expiresAt < new Date()) return;

  const newStatus = command === "APPROVE" ? "approved" : "rejected";

  await db
    .update(approvals)
    .set({
      status: newStatus,
      resolvedBy: user.id,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(approvals.id, approvalId));
}
