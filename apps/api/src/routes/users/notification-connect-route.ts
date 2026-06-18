import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, users } from "@mammoth/memory-database";
import { eq } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import { ValidationError, NotFoundError } from "@mammoth/shared/errors";
import { successResponse } from "@mammoth/shared/types";
import { generateTelegramConnectToken } from "../../notification-service-client.ts";

const WhatsAppConnectSchema = z.object({
  // E.164 format: +14155551234
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format (e.g. +14155551234)"),
});

export async function notificationConnectRoute(
  app: FastifyInstance
): Promise<void> {
  /**
   * GET /users/me/notifications/telegram-connect
   * Returns a one-time Telegram bot link. Founder opens it, bot stores chatId.
   */
  app.get(
    "/telegram-connect",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply) => {
      const { token, botLink } = await generateTelegramConnectToken(
        request.user.id
      );

      return reply.send(
        successResponse({
          botLink,
          token,
          expiresInSeconds: 600,
          instructions:
            "Open the link below in Telegram. Tap Start. Your account will be linked automatically.",
        })
      );
    }
  );

  /**
   * GET /users/me/notifications/telegram-status
   * Returns whether Telegram is connected for the authenticated user.
   */
  app.get(
    "/telegram-status",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply) => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, request.user.id),
        columns: { telegramChatId: true },
      });

      if (!user) throw new NotFoundError("User", request.user.id);

      return reply.send(
        successResponse({ connected: !!user.telegramChatId })
      );
    }
  );

  /**
   * DELETE /users/me/notifications/telegram-connect
   * Disconnects Telegram from this account.
   */
  app.delete(
    "/telegram-connect",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply) => {
      await db
        .update(users)
        .set({ telegramChatId: null })
        .where(eq(users.id, request.user.id));

      return reply.send(successResponse({ disconnected: true }));
    }
  );

  /**
   * POST /users/me/notifications/whatsapp-connect
   * Stores the founder's WhatsApp phone number (E.164).
   * Verification is done out-of-band by sending a WhatsApp message.
   */
  app.post(
    "/whatsapp-connect",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply) => {
      const result = WhatsAppConnectSchema.safeParse(request.body);
      if (!result.success) throw new ValidationError(result.error.message);

      await db
        .update(users)
        .set({ whatsappPhone: result.data.phone })
        .where(eq(users.id, request.user.id));

      return reply.status(201).send(
        successResponse({
          phone: result.data.phone,
          message: "WhatsApp phone saved. You will receive a test message shortly.",
        })
      );
    }
  );

  /**
   * DELETE /users/me/notifications/whatsapp-connect
   * Disconnects WhatsApp from this account.
   */
  app.delete(
    "/whatsapp-connect",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply) => {
      await db
        .update(users)
        .set({ whatsappPhone: null })
        .where(eq(users.id, request.user.id));

      return reply.send(successResponse({ disconnected: true }));
    }
  );
}
