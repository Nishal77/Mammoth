import { Page, expect } from "@playwright/test";

/**
 * Reusable auth actions shared across spec files.
 *
 * These drive the real UI at /login and /signup — they don't mock anything.
 * Use them in auth.spec.ts where you want to test the auth forms themselves.
 */

export const TEST_EMAIL = "e2e@mammoth.ai";
export const TEST_PASSWORD = "TestPass123!";
export const TEST_NAME = "E2E User";

/** Fill and submit the login form. Waits for redirect to /dashboard. */
export async function loginViaUI(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

/** Fill and submit the signup form. Waits for redirect to /onboarding. */
export async function signupViaUI(page: Page, name = TEST_NAME, email = TEST_EMAIL, password = TEST_PASSWORD): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/onboarding/);
}

/** Click the sign-out button and confirm redirect to /login. */
export async function logoutViaUI(page: Page): Promise<void> {
  await page.getByRole("button", { name: /sign out|logout/i }).click();
  await expect(page).toHaveURL(/login/);
}
