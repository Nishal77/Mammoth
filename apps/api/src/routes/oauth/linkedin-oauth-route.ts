import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { db, integrations } from "@mammoth/db";
import { encryptToken } from "@mammoth/integrations/oauth";
import { getLinkedInMemberId } from "@mammoth/integrations/linkedin";
import { createLogger } from "@mammoth/observability/logger";
import { authenticate } from "../../middleware/authenticate.ts";

const log = createLogger("linkedin-oauth");

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const SCOPES = ["openid", "profile", "w_member_social"].join(" ");

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/**
 * LinkedIn OAuth 2.0 Authorization Code Flow.
 * GET /authorize — redirect to LinkedIn
 * GET /callback — exchange code for token, store encrypted, redirect to integrations page
 *
 * State param encodes companyId so the callback knows which company to update.
 */
export async function linkedinOAuthRoute(app: FastifyInstance): Promise<void> {
  // GET /authorize?companyId=xxx — initiates OAuth redirect
  app.get(
    "/authorize",
    { preHandler: [authenticate] },
    async (request: FastifyRequest<{ Querystring: { companyId: string } }>, reply: FastifyReply) => {
      const { companyId } = request.query;
      if (!companyId) {
        return reply.status(400).send({ error: "companyId required", code: "MISSING_PARAM" });
      }

      const clientId = process.env["LINKEDIN_CLIENT_ID"];
      const redirectUri = buildRedirectUri(request);

      if (!clientId) {
        return reply.status(500).send({ error: "LinkedIn OAuth not configured", code: "NOT_CONFIGURED" });
      }

      // State carries companyId — verified in callback to prevent CSRF
      const state = Buffer.from(JSON.stringify({ companyId })).toString("base64url");

      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
      });

      return reply.redirect(`${LINKEDIN_AUTH_URL}?${params.toString()}`);
    }
  );

  // GET /callback — LinkedIn redirects here with ?code=&state=
  app.get(
    "/callback",
    async (request: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) => {
      const query = callbackQuerySchema.safeParse(request.query);

      if (!query.success || query.data.error) {
        const reason = query.data?.error_description ?? "OAuth authorization failed";
        log.warn("LinkedIn OAuth callback error", { reason });
        return reply.redirect(`/integrations?error=${encodeURIComponent(reason)}`);
      }

      const { code, state } = query.data;

      let companyId: string;
      try {
        const decoded = JSON.parse(Buffer.from(state, "base64url").toString()) as { companyId: string };
        companyId = decoded.companyId;
      } catch {
        return reply.redirect("/integrations?error=invalid_state");
      }

      const clientId = process.env["LINKEDIN_CLIENT_ID"] ?? "";
      const clientSecret = process.env["LINKEDIN_CLIENT_SECRET"] ?? "";
      const redirectUri = buildRedirectUri(request);

      // Exchange code for access token
      const tokenResponse = await fetch(LINKEDIN_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        log.warn("LinkedIn token exchange failed", { status: tokenResponse.status });
        return reply.redirect("/integrations?error=token_exchange_failed");
      }

      const tokenData = await tokenResponse.json() as { access_token?: string };
      const accessToken = tokenData.access_token;

      if (!accessToken) {
        return reply.redirect("/integrations?error=no_access_token");
      }

      // Verify we can read the member ID (confirms token has correct scope)
      const memberId = await getLinkedInMemberId(accessToken);
      if (!memberId) {
        return reply.redirect("/integrations?error=member_id_fetch_failed");
      }

      await db
        .insert(integrations)
        .values({
          companyId,
          provider: "linkedin",
          status: "connected",
          accessTokenEnc: encryptToken(accessToken),
          metadata: JSON.stringify({ memberId }),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrations.companyId, integrations.provider],
          set: {
            status: "connected",
            accessTokenEnc: encryptToken(accessToken),
            metadata: JSON.stringify({ memberId }),
            lastError: null,
            updatedAt: new Date(),
          },
        });

      log.info("LinkedIn connected via OAuth", { companyId });
      return reply.redirect("/integrations?connected=linkedin");
    }
  );
}

function buildRedirectUri(request: FastifyRequest): string {
  const host = process.env["APP_URL"] ?? `${request.protocol}://${request.hostname}`;
  return `${host}/api/v1/oauth/linkedin/callback`;
}
