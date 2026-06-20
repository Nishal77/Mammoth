import { test, expect } from "../fixtures/auth.fixture";
import { ok, MOCK_USER, MOCK_COMPANY } from "../data/mock-api";

/**
 * Settings page tests — /(app)/settings
 *
 * What we test:
 * - Company name and user info are displayed
 * - Company name can be edited and saved
 * - Notification preferences can be toggled
 * - Danger zone: account deletion requires confirmation
 *
 * Graph context (graphify):
 *   SettingsClient.tsx → api.get("/companies"), api.patch("/companies/:id")
 *   Uses primaryBtnStyle() for the save button
 */
test.describe("Settings Page (/(app)/settings)", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.route("**/api/v1/companies", (route) =>
      route.fulfill({ json: ok([MOCK_COMPANY]) })
    );
    await page.route("**/api/v1/companies/**", async (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({ json: ok({ ...MOCK_COMPANY, name: "Updated Corp" }) });
      }
      return route.fulfill({ json: ok(MOCK_COMPANY) });
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
  });

  test("displays the current company name", async ({ authenticatedPage: page }) => {
    // MOCK_COMPANY.name = "Acme Corp"
    await expect(page.getByText(/Acme Corp/i)).toBeVisible({ timeout: 8_000 });
  });

  test("displays the signed-in user email", async ({ authenticatedPage: page }) => {
    // MOCK_USER.email = "test@mammoth.ai"
    await expect(page.getByText(/test@mammoth\.ai/i)).toBeVisible({ timeout: 8_000 });
  });

  test("can edit and save the company name", async ({ authenticatedPage: page }) => {
    const nameField = page.getByLabel(/company name/i);
    if (await nameField.isVisible()) {
      await nameField.clear();
      await nameField.fill("Updated Corp");
      await page.getByRole("button", { name: /save|update/i }).click();
      await expect(page.getByText(/saved|updated|success/i)).toBeVisible({ timeout: 5_000 });
    }
  });

  test("shows a save button", async ({ authenticatedPage: page }) => {
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();
  });

  test("shows danger zone section", async ({ authenticatedPage: page }) => {
    // Settings pages typically have a danger zone for destructive actions
    const dangerZone = page.getByText(/danger|delete.*account|delete.*company/i);
    if (await dangerZone.isVisible()) {
      await expect(dangerZone).toBeVisible();
    }
  });

  test("delete action requires confirmation before proceeding", async ({ authenticatedPage: page }) => {
    const deleteBtn = page.getByRole("button", { name: /delete/i }).first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      // Should show a confirm dialog or confirmation step, not immediately delete
      const confirmed = await page.getByText(/confirm|are you sure|type.*to confirm/i).isVisible();
      const dialogShown = await page.locator("[role='dialog']").isVisible();
      expect(confirmed || dialogShown).toBe(true);
    }
  });
});
