import Fastify from "fastify";
import Redis from "ioredis";
import { telegramBot } from "./telegram/telegram-bot.ts";
import { registerTelegramStartHandler } from "./telegram/telegram-connect.ts";
import { whatsappWebhookRoute } from "./whatsapp/whatsapp-webhook.ts";
import { dispatch } from "./notification-dispatcher.ts";
import type { NotificationEvent } from "@mammoth/shared/events";
import { NOTIFICATION_CHANNEL } from "@mammoth/shared/events";

const IS_PRODUCTION = process.env["NODE_ENV"] === "production";
const PORT = Number(process.env["NOTIFICATION_SERVICE_PORT"] ?? 3002);

async function startNotificationService(): Promise<void> {
  registerTelegramStartHandler();
  await startTelegramBot();
  await startWebhookServer();
  startNotificationSubscriber();
}

function startNotificationSubscriber(): void {
  if (!process.env["REDIS_URL"]) {
    throw new Error("REDIS_URL environment variable is required");
  }

  // Dedicated Redis connection for SUBSCRIBE (cannot issue other commands while subscribed)
  const subscriber = new Redis(process.env["REDIS_URL"]);

  subscriber.subscribe(NOTIFICATION_CHANNEL, (err) => {
    if (err) {
      console.error("[notification-service] Redis subscribe error:", err.message);
      return;
    }
    console.log(`[notification-service] Subscribed to ${NOTIFICATION_CHANNEL}`);
  });

  subscriber.on("message", (_channel: string, message: string) => {
    let event: NotificationEvent;

    try {
      event = JSON.parse(message) as NotificationEvent;
    } catch {
      console.error("[notification-service] Malformed notification message:", message);
      return;
    }

    void dispatch(event).catch((error: unknown) => {
      console.error(
        "[notification-service] Dispatch error:",
        error instanceof Error ? error.message : error,
        { type: event.type }
      );
    });
  });

  subscriber.on("error", (err) => {
    console.error("[notification-service] Subscriber error:", err.message);
  });
}

async function startTelegramBot(): Promise<void> {
  if (IS_PRODUCTION) {
    const webhookDomain = process.env["TELEGRAM_WEBHOOK_DOMAIN"];
    const webhookPath = `/webhooks/telegram/${process.env["TELEGRAM_BOT_TOKEN"]}`;

    if (!webhookDomain) {
      throw new Error("TELEGRAM_WEBHOOK_DOMAIN required in production");
    }

    await telegramBot.api.setWebhook(`${webhookDomain}${webhookPath}`);
    console.log("Telegram webhook registered:", webhookDomain + webhookPath);
  } else {
    // Long polling in dev — no domain needed
    void telegramBot.start({
      onStart: () => console.log("Telegram bot polling started"),
    });
  }
}

async function startWebhookServer(): Promise<void> {
  const app = Fastify({ logger: { level: "info" } });

  // WhatsApp inbound webhook
  await app.register(whatsappWebhookRoute);

  // Telegram webhook endpoint (production only — grammy handles routing)
  if (IS_PRODUCTION) {
    const { webhookCallback } = await import("grammy");
    const webhookPath = `/webhooks/telegram/${process.env["TELEGRAM_BOT_TOKEN"]}`;
    app.post(webhookPath, async (request, reply) => {
      await webhookCallback(telegramBot, "fastify")(request, reply);
    });
  }

  // Health check
  app.get("/health", async () => ({ status: "ok", service: "notification" }));

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Notification service listening on port ${PORT}`);
}

startNotificationService().catch((error) => {
  console.error("Notification service failed to start:", error);
  process.exit(1);
});
