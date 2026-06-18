import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, integrations } from "@mammoth/memory-database";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import { encryptToken } from "@mammoth/tool-oauth";
import { syncHubspot } from "@mammoth/tool-crm";
import { verifySlackToken } from "@mammoth/tool-slack";
import { verifyGithubToken } from "@mammoth/tool-github";
import { verifyTwitterToken } from "@mammoth/tool-twitter";
import { isValidWebhookUrl } from "@mammoth/tool-n8n";

const SUPPORTED_PROVIDERS = [
  "stripe", "hubspot", "github", "slack", "plausible",
  "linkedin", "twitter", "apollo", "exa", "vapi", "n8n",
] as const;

type Provider = (typeof SUPPORTED_PROVIDERS)[number];

// Input schemas — one per provider
const connectStripeSchema = z.object({
  webhookSecret: z.string().min(10),
});

const connectHubspotSchema = z.object({
  accessToken: z.string().min(10),
});

const connectGithubSchema = z.object({
  accessToken: z.string().min(10),
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const connectSlackSchema = z.object({
  botToken: z.string().startsWith("xoxb-"),
  channel: z.string().min(1).regex(/^[#C]/),
});

const connectPlausibleSchema = z.object({
  apiKey: z.string().min(10),
  siteId: z.string().min(1),
});

const connectLinkedInSchema = z.object({
  accessToken: z.string().min(10),
});

const connectTwitterSchema = z.object({
  bearerToken: z.string().min(10),
});

const connectApolloSchema = z.object({
  apiKey: z.string().min(10),
});

const connectExaSchema = z.object({
  apiKey: z.string().min(10),
});

const connectVapiSchema = z.object({
  apiKey: z.string().min(10),
  phoneNumberId: z.string().min(1, "Vapi phone number ID is required"),
  defaultToPhone: z.string().optional(),
});

const connectN8nSchema = z.object({
  webhookUrl: z.string().url(),
});

/**
 * Routes for managing company integrations.
 * All routes require authentication and company membership.
 * Prefix: /api/v1/companies/:companyId/integrations
 */
export async function integrationsRoute(app: FastifyInstance): Promise<void> {
  // GET / — list all integrations (tokens never returned to client)
  app.get(
    "/",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };

      const rows = await db.query.integrations.findMany({
        where: eq(integrations.companyId, companyId),
        columns: {
          id: true,
          provider: true,
          status: true,
          scopes: true,
          lastUsedAt: true,
          lastError: true,
          createdAt: true,
          accessTokenEnc: false,
          refreshTokenEnc: false,
          metadata: false,
        },
      });

      return reply.send({ data: rows });
    }
  );

  // POST /stripe
  app.post(
    "/stripe",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectStripeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      await upsertIntegration(companyId, "stripe", null, { webhookSecret: parsed.data.webhookSecret });
      return reply.status(201).send({ data: { provider: "stripe", status: "connected" } });
    }
  );

  // POST /hubspot
  app.post(
    "/hubspot",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectHubspotSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      await upsertIntegration(companyId, "hubspot", parsed.data.accessToken);
      void syncHubspot(companyId).catch(() => undefined);
      return reply.status(201).send({ data: { provider: "hubspot", status: "connected" } });
    }
  );

  // POST /github
  app.post(
    "/github",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectGithubSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      const githubLogin = await verifyGithubToken(parsed.data.accessToken);
      if (!githubLogin) {
        return reply.status(400).send({ error: "GitHub token verification failed.", code: "INVALID_TOKEN" });
      }
      await upsertIntegration(companyId, "github", parsed.data.accessToken, {
        owner: parsed.data.owner,
        repo: parsed.data.repo,
        githubLogin,
      });
      return reply.status(201).send({ data: { provider: "github", status: "connected", login: githubLogin } });
    }
  );

  // POST /slack
  app.post(
    "/slack",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectSlackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      const workspace = await verifySlackToken(parsed.data.botToken);
      if (!workspace) {
        return reply.status(400).send({ error: "Slack token verification failed.", code: "INVALID_TOKEN" });
      }
      await upsertIntegration(companyId, "slack", parsed.data.botToken, {
        channel: parsed.data.channel,
        workspace,
      });
      return reply.status(201).send({ data: { provider: "slack", status: "connected", workspace } });
    }
  );

  // POST /plausible
  app.post(
    "/plausible",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectPlausibleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      await upsertIntegration(companyId, "plausible", parsed.data.apiKey, { siteId: parsed.data.siteId });
      return reply.status(201).send({ data: { provider: "plausible", status: "connected" } });
    }
  );

  // POST /linkedin — store LinkedIn access token (obtained via OAuth redirect flow)
  app.post(
    "/linkedin",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectLinkedInSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      await upsertIntegration(companyId, "linkedin", parsed.data.accessToken);
      return reply.status(201).send({ data: { provider: "linkedin", status: "connected" } });
    }
  );

  // POST /twitter — store Twitter bearer token
  app.post(
    "/twitter",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectTwitterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      const twitterHandle = await verifyTwitterToken(parsed.data.bearerToken);
      if (!twitterHandle) {
        return reply.status(400).send({ error: "Twitter token verification failed.", code: "INVALID_TOKEN" });
      }
      await upsertIntegration(companyId, "twitter", parsed.data.bearerToken, { handle: twitterHandle });
      return reply.status(201).send({ data: { provider: "twitter", status: "connected", handle: twitterHandle } });
    }
  );

  // POST /apollo — store Apollo API key
  app.post(
    "/apollo",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectApolloSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      await upsertIntegration(companyId, "apollo", parsed.data.apiKey);
      return reply.status(201).send({ data: { provider: "apollo", status: "connected" } });
    }
  );

  // POST /exa — store Exa API key
  app.post(
    "/exa",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectExaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      await upsertIntegration(companyId, "exa", parsed.data.apiKey);
      return reply.status(201).send({ data: { provider: "exa", status: "connected" } });
    }
  );

  // POST /vapi — store Vapi config (API key + phone number)
  app.post(
    "/vapi",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectVapiSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      await upsertIntegration(companyId, "vapi", parsed.data.apiKey, {
        phoneNumberId: parsed.data.phoneNumberId,
        defaultToPhone: parsed.data.defaultToPhone,
      });
      return reply.status(201).send({ data: { provider: "vapi", status: "connected" } });
    }
  );

  // POST /n8n — store N8N outbound webhook URL
  app.post(
    "/n8n",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const parsed = connectN8nSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message, code: "VALIDATION_ERROR" });
      }
      if (!isValidWebhookUrl(parsed.data.webhookUrl)) {
        return reply.status(400).send({ error: "Invalid webhook URL.", code: "INVALID_URL" });
      }
      // N8N uses no auth token — metadata only
      await upsertIntegration(companyId, "n8n", null, { webhookUrl: parsed.data.webhookUrl });
      return reply.status(201).send({ data: { provider: "n8n", status: "connected" } });
    }
  );

  // DELETE /:provider — disconnect any integration
  app.delete<{ Params: { companyId: string; provider: string } }>(
    "/:provider",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId, provider } = request.params;

      if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
        return reply.status(400).send({
          error: `Unknown provider: ${provider}`,
          code: "UNKNOWN_PROVIDER",
        });
      }

      await db
        .update(integrations)
        .set({ status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, updatedAt: new Date() })
        .where(and(eq(integrations.companyId, companyId), eq(integrations.provider, provider)));

      return reply.send({ data: { provider, status: "revoked" } });
    }
  );

  // POST /hubspot/sync — manual HubSpot sync
  app.post(
    "/hubspot/sync",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const syncResult = await syncHubspot(companyId);
      return reply.send({ data: syncResult });
    }
  );
}

/**
 * Upsert an integration row. Encrypts the token if provided.
 * Centralises the repetitive insert+onConflict pattern.
 */
async function upsertIntegration(
  companyId: string,
  provider: string,
  accessToken: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  const encryptedToken = accessToken
    ? (await import("@mammoth/tool-oauth")).encryptToken(accessToken)
    : null;

  await db
    .insert(integrations)
    .values({
      companyId,
      provider,
      status: "connected",
      accessTokenEnc: encryptedToken,
      metadata: metadata ? JSON.stringify(metadata) : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [integrations.companyId, integrations.provider],
      set: {
        status: "connected",
        ...(encryptedToken !== null ? { accessTokenEnc: encryptedToken } : {}),
        ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
        lastError: null,
        updatedAt: new Date(),
      },
    });
}
