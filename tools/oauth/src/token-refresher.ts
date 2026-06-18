import { db, integrations } from "@mammoth/memory-database";
import { and, eq } from "drizzle-orm";
import { encryptToken, decryptToken } from "./token-encryptor.ts";

// Refresh 5 minutes before actual expiry to avoid race conditions
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

type SupportedProvider = "hubspot" | "github" | "slack";

type RefreshResult =
  | { isValid: true; accessToken: string }
  | { isValid: false; reason: string };

/**
 * Returns the access token for an integration, refreshing it first if
 * it expires within the next 5 minutes. Updates the database on refresh.
 *
 * Returns { isValid: false } when:
 * - No integration row exists for the company/provider
 * - The integration is in an error or revoked state
 * - The refresh request to the provider fails
 *
 * @param companyId - The company whose integration to load
 * @param provider  - The integration provider (hubspot | github | slack)
 */
export async function getValidAccessToken(
  companyId: string,
  provider: SupportedProvider
): Promise<RefreshResult> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.provider, provider)
    ),
    columns: {
      id: true,
      status: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
      tokenExpiresAt: true,
    },
  });

  if (!integration) {
    return { isValid: false, reason: `No ${provider} integration found` };
  }

  if (integration.status === "revoked" || integration.status === "error") {
    return {
      isValid: false,
      reason: `${provider} integration status is ${integration.status}`,
    };
  }

  if (!integration.accessTokenEnc) {
    return { isValid: false, reason: `${provider} integration has no access token` };
  }

  const accessToken = decryptToken(integration.accessTokenEnc);

  // Token has no expiry or is still valid — return as-is
  if (!integration.tokenExpiresAt) {
    return { isValid: true, accessToken };
  }

  const expiresAt = new Date(integration.tokenExpiresAt).getTime();
  const isAboutToExpire = expiresAt - Date.now() < REFRESH_BUFFER_MS;

  if (!isAboutToExpire) {
    return { isValid: true, accessToken };
  }

  // Token is expiring — try to refresh
  if (!integration.refreshTokenEnc) {
    return { isValid: false, reason: `${provider} token expired and no refresh token available` };
  }

  const refreshToken = decryptToken(integration.refreshTokenEnc);

  return refreshAccessToken({
    integrationId: integration.id,
    provider,
    refreshToken,
  });
}

/**
 * Calls the provider's token refresh endpoint and stores the new tokens.
 * Each provider has different token endpoint URLs and request formats.
 */
async function refreshAccessToken(options: {
  integrationId: string;
  provider: SupportedProvider;
  refreshToken: string;
}): Promise<RefreshResult> {
  const { integrationId, provider, refreshToken } = options;

  try {
    const tokens = await fetchNewTokensFromProvider(provider, refreshToken);

    const expiresAt = tokens.expiresInSeconds
      ? new Date(Date.now() + tokens.expiresInSeconds * 1000)
      : null;

    await db
      .update(integrations)
      .set({
        accessTokenEnc: encryptToken(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken
          ? encryptToken(tokens.refreshToken)
          : undefined,
        tokenExpiresAt: expiresAt ?? undefined,
        status: "connected",
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId));

    return { isValid: true, accessToken: tokens.accessToken };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Mark integration as errored so the founder knows to reconnect
    await db
      .update(integrations)
      .set({ status: "error", lastError: message, updatedAt: new Date() })
      .where(eq(integrations.id, integrationId));

    return { isValid: false, reason: `Token refresh failed: ${message}` };
  }
}

/**
 * Performs the actual HTTP call to the provider's token endpoint.
 * Returns the new access token, optional refresh token, and expiry.
 */
async function fetchNewTokensFromProvider(
  provider: SupportedProvider,
  refreshToken: string
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
}> {
  if (provider === "hubspot") {
    return refreshHubspotToken(refreshToken);
  }

  if (provider === "slack") {
    return refreshSlackToken(refreshToken);
  }

  // GitHub personal access tokens do not expire (no refresh needed).
  // GitHub OAuth apps do expire — but we handle that case by returning isValid: false above.
  throw new Error(`Token refresh not supported for provider: ${provider}`);
}

async function refreshHubspotToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}> {
  const clientId = process.env["HUBSPOT_CLIENT_ID"];
  const clientSecret = process.env["HUBSPOT_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    throw new Error("HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET are required");
  }

  const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`HubSpot token refresh failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresInSeconds: body.expires_in,
  };
}

async function refreshSlackToken(_refreshToken: string): Promise<{
  accessToken: string;
}> {
  // Slack bot tokens (xoxb-) do not expire unless revoked.
  // Slack user tokens (xoxp-) can be refreshed via token rotation.
  // For Phase 11 we use bot tokens — this path is a safety net.
  throw new Error(
    "Slack token rotation is not yet configured. Re-connect the Slack integration."
  );
}
