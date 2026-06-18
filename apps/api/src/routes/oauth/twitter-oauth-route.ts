import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, integrations } from "@mammoth/memory-database";
import { encryptToken } from "@mammoth/tool-oauth";
import { createLogger } from "@mammoth/observability/logger";
import { authenticate } from "../../middleware/authenticate.ts";

const log = createLogger("twitter-oauth");

const TWITTER_AUTH_URL = "https://twitter.com/i/oauth2/authorize";
const TWITTER_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const SCOPES = ["tweet.read", "tweet.write", "users.read"].join(" ");

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/**
 * Twitter OAuth 2.0 PKCE Authorization Code Flow.
 * GET /authorize — redirect to Twitter
 * GET /callback — exchange code for token, store encrypted, redirect to integrations page
 */
export async function twitterOAuthRoute(app: FastifyInstance): Promise<void> {
  // GET /authorize?companyId=xxx
  app.get<{ Querystring: { companyId: string } }>(
    "/authorize",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { companyId } = request.query;
      if (!companyId) {
        return reply.status(400).send({ error: "companyId required", code: "MISSING_PARAM" });
      }

      const clientId = process.env["TWITTER_CLIENT_ID"];
      if (!clientId) {
        return reply.status(500).send({ error: "Twitter OAuth not configured", code: "NOT_CONFIGURED" });
      }

      // PKCE code verifier + challenge (S256)
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const redirectUri = buildRedirectUri(request);

      // State encodes companyId + code verifier for CSRF protection and PKCE
      const state = Buffer.from(JSON.stringify({ companyId, codeVerifier })).toString("base64url");

      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });

      return reply.redirect(`${TWITTER_AUTH_URL}?${params.toString()}`);
    }
  );

  // GET /callback
  app.get<{ Querystring: Record<string, string> }>(
    "/callback",
    async (request, reply) => {
      const query = callbackQuerySchema.safeParse(request.query);

      if (!query.success || query.data.error) {
        const reason = query.data?.error_description ?? "Twitter OAuth authorization failed";
        log.warn("Twitter OAuth callback error", { reason });
        return reply.redirect(`/integrations?error=${encodeURIComponent(reason)}`);
      }

      const { code, state } = query.data;

      let companyId: string;
      let codeVerifier: string;
      try {
        const decoded = JSON.parse(Buffer.from(state, "base64url").toString()) as {
          companyId: string;
          codeVerifier: string;
        };
        companyId = decoded.companyId;
        codeVerifier = decoded.codeVerifier;
      } catch {
        return reply.redirect("/integrations?error=invalid_state");
      }

      const clientId = process.env["TWITTER_CLIENT_ID"] ?? "";
      const clientSecret = process.env["TWITTER_CLIENT_SECRET"] ?? "";
      const redirectUri = buildRedirectUri(request);

      // Exchange code for access token (PKCE)
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const tokenResponse = await fetch(TWITTER_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        log.warn("Twitter token exchange failed", { status: tokenResponse.status });
        return reply.redirect("/integrations?error=token_exchange_failed");
      }

      const tokenData = await tokenResponse.json() as { access_token?: string; username?: string };
      const accessToken = tokenData.access_token;

      if (!accessToken) {
        return reply.redirect("/integrations?error=no_access_token");
      }

      await db
        .insert(integrations)
        .values({
          companyId,
          provider: "twitter",
          status: "connected",
          accessTokenEnc: encryptToken(accessToken),
          metadata: tokenData.username ? JSON.stringify({ handle: tokenData.username }) : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrations.companyId, integrations.provider],
          set: {
            status: "connected",
            accessTokenEnc: encryptToken(accessToken),
            ...(tokenData.username ? { metadata: JSON.stringify({ handle: tokenData.username }) } : {}),
            lastError: null,
            updatedAt: new Date(),
          },
        });

      log.info("Twitter connected via OAuth", { companyId });
      return reply.redirect("/integrations?connected=twitter");
    }
  );
}

function buildRedirectUri(request: FastifyRequest): string {
  const host = process.env["APP_URL"] ?? `${request.protocol}://${request.hostname}`;
  return `${host}/api/v1/oauth/twitter/callback`;
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString("base64url");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("base64url");
}
