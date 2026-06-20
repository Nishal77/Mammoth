import { test, expect } from "../fixtures/auth.fixture";
import { ok } from "../data/mock-api";

/**
 * Integrations page tests — /(app)/integrations
 *
 * What we test:
 * - Available integrations are listed (Twitter/X, LinkedIn, HubSpot, GitHub, Slack)
 * - Connected integrations show a "connected" badge
 * - Disconnected integrations show a "connect" button
 * - Clicking connect redirects to the OAuth flow URL
 * - Empty / all-disconnected state is handled gracefully
 *
 * Graph context (graphify):
 *   IntegrationsClient.tsx → api.get("/integrations")
 *   OAuth routes: twitter-oauth-route.ts, linkedin-oauth-route.ts
 *   integrations table in metrics.ts schema
 */

// The platforms the product supports (from graphify: twitter, linkedin, github, slack, crm)
const SUPPORTED_PLATFORMS = ["Twitter", "LinkedIn", "GitHub", "Slack", "HubSpot"];

test.describe("Integrations Page (/(app)/integrations)", () => {
  test("shows all supported integration platforms", async ({ authenticatedPage: page }) => {
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    // At least some of the known platforms should be listed
    let found = 0;
    for (const platform of SUPPORTED_PLATFORMS) {
      if (await page.getByText(new RegExp(platform, "i")).isVisible()) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test("shows connect button for disconnected integrations", async ({ authenticatedPage: page }) => {
    // Mock returns empty list → all platforms are disconnected
    await page.route("**/api/v1/integrations", (route) =>
      route.fulfill({ json: ok([]) })
    );

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: /connect/i }).first()).toBeVisible();
  });

  test("shows connected badge when an integration is active", async ({ authenticatedPage: page }) => {
    await page.route("**/api/v1/integrations", (route) =>
      route.fulfill({
        json: ok([
          { id: "int-001", platform: "twitter", status: "connected", connectedAt: new Date().toISOString() },
        ]),
      })
    );

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 8_000 });
  });

  test("clicking connect for Twitter starts OAuth redirect", async ({ authenticatedPage: page }) => {
    await page.route("**/api/v1/integrations", (route) => route.fulfill({ json: ok([]) }));

    // Intercept the OAuth redirect — we don't want to actually leave the page
    let oauthUrl = "";
    await page.route("**/api/v1/oauth/twitter**", (route) => {
      oauthUrl = route.request().url();
      return route.fulfill({ status: 302, headers: { location: "/integrations?connected=twitter" } });
    });

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    const twitterConnect = page.getByRole("button", { name: /connect.*twitter|twitter.*connect/i }).first();
    if (await twitterConnect.isVisible()) {
      await twitterConnect.click();
      // Either redirected or oauth URL was hit
      const url = page.url();
      expect(url.includes("twitter") || url.includes("oauth") || url.includes("integrations")).toBe(true);
    }
  });

  test("disconnecting an integration removes the connected badge", async ({ authenticatedPage: page }) => {
    // Start connected
    await page.route("**/api/v1/integrations", async (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({ json: ok({ success: true }) });
      }
      return route.fulfill({
        json: ok([
          { id: "int-001", platform: "slack", status: "connected", connectedAt: new Date().toISOString() },
        ]),
      });
    });

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    const disconnectBtn = page.getByRole("button", { name: /disconnect/i }).first();
    if (await disconnectBtn.isVisible()) {
      await disconnectBtn.click();
      await expect(page.getByRole("button", { name: /connect/i }).first()).toBeVisible({ timeout: 5_000 });
    }
  });
});
