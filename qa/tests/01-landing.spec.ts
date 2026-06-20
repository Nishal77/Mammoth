import { test, expect } from "@playwright/test";

/**
 * Landing page tests — /
 *
 * What we test:
 * - Page loads with the correct title and headline
 * - Navigation links (Login, Sign Up) are visible and functional
 * - The page is accessible (no broken layout at 375px mobile width)
 *
 * No auth or API mocks needed — landing page is fully public.
 */
test.describe("Landing Page (/)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the product name and headline", async ({ page }) => {
    await expect(page).toHaveTitle(/MAMMOTH|Mammoth|MERIDIAN/i);
    // The hero headline should be visible above the fold
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("has a working Login link that leads to /login", async ({ page }) => {
    await page.getByRole("link", { name: /log in|sign in/i }).first().click();
    await expect(page).toHaveURL(/login/);
  });

  test("has a working Sign Up link that leads to /signup", async ({ page }) => {
    await page.getByRole("link", { name: /sign up|get started|start/i }).first().click();
    await expect(page).toHaveURL(/signup/);
  });

  test("renders correctly on mobile (375px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // Main heading should still be visible — no overflow hiding it
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
