import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, integrations } from "@mammoth/db";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../middleware/authenticate.ts";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import { encryptToken } from "@mammoth/integrations/oauth";
import { syncHubspot } from "@mammoth/integrations/hubspot";
import { verifySlackToken } from "@mammoth/integrations/slack";
import { verifyGithubToken } from "@mammoth/integrations/github";

// Supported integration providers
const SUPPORTED_PROVIDERS = [
  "stripe",
  "hubspot",
  "github",
  "slack",
  "plausible",
] as const;

type Provider = (typeof SUPPORTED_PROVIDERS)[number];

const connectStripeSchema = z.object({
  webhookSecret: z.string().min(10, "Webhook secret must be at least 10 characters"),
});

const connectHubspotSchema = z.object({
  accessToken: z.string().min(10, "HubSpot access token is required"),
});

const connectGithubSchema = z.object({
  accessToken: z.string().min(10, "GitHub personal access token is required"),
  owner: z.string().min(1, "GitHub owner (org or username) is required"),
  repo: z.string().min(1, "GitHub repository name is required"),
});

const connectSlackSchema = z.object({
  botToken: z.string().startsWith("xoxb-", "Slack bot token must start with xoxb-"),
  channel: z
    .string()
    .min(1)
    .regex(/^[#C]/, "Channel must be a name (#channel) or channel ID"),
});

const connectPlausibleSchema = z.object({
  apiKey: z.string().min(10, "Plausible API key is required"),
  siteId: z.string().min(1, "Plausible site ID (domain) is required"),
});

/**
 * Routes for managing company integrations.
 * All routes require authentication and company membership.
 * Prefix: /api/v1/companies/:companyId/integrations
 */
export async function integrationsRoute(app: FastifyInstance): Promise<void> {
  // List all integrations for a company
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
          // Never return encrypted tokens to the client
          accessTokenEnc: false,
          refreshTokenEnc: false,
          metadata: false,
        },
      });

      return reply.send({ data: rows });
    }
  );

  // Connect Stripe (save webhook secret for MRR tracking)
  app.post(
    "/stripe",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };

      const parsed = connectStripeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid input",
          code: "VALIDATION_ERROR",
        });
      }

      await db
        .insert(integrations)
        .values({
          companyId,
          provider: "stripe",
          status: "connected",
          // Store the webhook secret in metadata (not as a token — it doesn't expire)
          metadata: JSON.stringify({ webhookSecret: parsed.data.webhookSecret }),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrations.companyId, integrations.provider],
          set: {
            status: "connected",
            metadata: JSON.stringify({ webhookSecret: parsed.data.webhookSecret }),
            lastError: null,
            updatedAt: new Date(),
          },
        });

      return reply.status(201).send({ data: { provider: "stripe", status: "connected" } });
    }
  );

  // Connect HubSpot (private app token)
  app.post(
    "/hubspot",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };

      const parsed = connectHubspotSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid input",
          code: "VALIDATION_ERROR",
        });
      }

      await db
        .insert(integrations)
        .values({
          companyId,
          provider: "hubspot",
          status: "connected",
          accessTokenEnc: encryptToken(parsed.data.accessToken),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrations.companyId, integrations.provider],
          set: {
            status: "connected",
            accessTokenEnc: encryptToken(parsed.data.accessToken),
            lastError: null,
            updatedAt: new Date(),
          },
        });

      // Trigger an immediate sync in the background
      void syncHubspot(companyId).catch((error: unknown) => {
        request.log.warn(
          { companyId, error: error instanceof Error ? error.message : String(error) },
          "Initial HubSpot sync failed"
        );
      });

      return reply.status(201).send({ data: { provider: "hubspot", status: "connected" } });
    }
  );

  // Connect GitHub (personal access token)
  app.post(
    "/github",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };

      const parsed = connectGithubSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid input",
          code: "VALIDATION_ERROR",
        });
      }

      // Verify the token before storing it
      const githubLogin = await verifyGithubToken(parsed.data.accessToken);
      if (!githubLogin) {
        return reply.status(400).send({
          error: "GitHub token verification failed. Check that the token has repo read access.",
          code: "INVALID_TOKEN",
        });
      }

      await db
        .insert(integrations)
        .values({
          companyId,
          provider: "github",
          status: "connected",
          accessTokenEnc: encryptToken(parsed.data.accessToken),
          metadata: JSON.stringify({
            owner: parsed.data.owner,
            repo: parsed.data.repo,
            githubLogin,
          }),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrations.companyId, integrations.provider],
          set: {
            status: "connected",
            accessTokenEnc: encryptToken(parsed.data.accessToken),
            metadata: JSON.stringify({
              owner: parsed.data.owner,
              repo: parsed.data.repo,
              githubLogin,
            }),
            lastError: null,
            updatedAt: new Date(),
          },
        });

      return reply.status(201).send({ data: { provider: "github", status: "connected", login: githubLogin } });
    }
  );

  // Connect Slack (bot token)
  app.post(
    "/slack",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };

      const parsed = connectSlackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid input",
          code: "VALIDATION_ERROR",
        });
      }

      // Verify the token before storing it
      const workspace = await verifySlackToken(parsed.data.botToken);
      if (!workspace) {
        return reply.status(400).send({
          error: "Slack token verification failed. Check the bot token starts with xoxb-.",
          code: "INVALID_TOKEN",
        });
      }

      await db
        .insert(integrations)
        .values({
          companyId,
          provider: "slack",
          status: "connected",
          accessTokenEnc: encryptToken(parsed.data.botToken),
          metadata: JSON.stringify({ channel: parsed.data.channel, workspace }),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrations.companyId, integrations.provider],
          set: {
            status: "connected",
            accessTokenEnc: encryptToken(parsed.data.botToken),
            metadata: JSON.stringify({ channel: parsed.data.channel, workspace }),
            lastError: null,
            updatedAt: new Date(),
          },
        });

      return reply.status(201).send({ data: { provider: "slack", status: "connected", workspace } });
    }
  );

  // Connect Plausible analytics (API key + site ID)
  app.post(
    "/plausible",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };

      const parsed = connectPlausibleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid input",
          code: "VALIDATION_ERROR",
        });
      }

      await db
        .insert(integrations)
        .values({
          companyId,
          provider: "plausible",
          status: "connected",
          accessTokenEnc: encryptToken(parsed.data.apiKey),
          metadata: JSON.stringify({ siteId: parsed.data.siteId }),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrations.companyId, integrations.provider],
          set: {
            status: "connected",
            accessTokenEnc: encryptToken(parsed.data.apiKey),
            metadata: JSON.stringify({ siteId: parsed.data.siteId }),
            lastError: null,
            updatedAt: new Date(),
          },
        });

      return reply.status(201).send({ data: { provider: "plausible", status: "connected" } });
    }
  );

  // Disconnect an integration
  app.delete<{ Params: { companyId: string; provider: string } }>(
    "/:provider",
    { preHandler: [authenticate, requireCompanyAccess] },
    async (request, reply) => {
      const { companyId, provider } = request.params;

      if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
        return reply.status(400).send({
          error: `Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
          code: "UNKNOWN_PROVIDER",
        });
      }

      await db
        .update(integrations)
        .set({
          status: "revoked",
          accessTokenEnc: null,
          refreshTokenEnc: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrations.companyId, companyId),
            eq(integrations.provider, provider)
          )
        );

      return reply.send({ data: { provider, status: "revoked" } });
    }
  );

  // Trigger a manual HubSpot sync
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
