import { test, expect } from "@playwright/test";
import { ok } from "../data/mock-api";

/**
 * Authentication flow tests — /login and /signup
 *
 * What we test:
 * - Login form renders correct fields
 * - Empty form submission shows validation
 * - Successful login redirects to /dashboard
 * - Failed login shows an error message
 * - Signup form renders correct fields
 * - Successful signup redirects to /onboarding
 * - Unauthenticated users are redirected to /login from protected routes
 *
 * We mock the better-auth API responses so no real auth server is needed.
 */
test.describe("Auth — Login (/login)", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the better-auth sign-in endpoint
    await page.route("**/api/auth/sign-in/email", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { email?: string; password?: string };

      if (body.email === "test@mammoth.ai" && body.password === "TestPass123!") {
        return route.fulfill({
          json: {
            user: { id: "user-001", email: "test@mammoth.ai", name: "E2E Tester" },
            session: { id: "sess-001" },
          },
        });
      }

      // Wrong credentials
      return route.fulfill({
        status: 401,
        json: { error: "Invalid email or password", code: "INVALID_CREDENTIALS" },
      });
    });

    // Mock session check so dashboard doesn't redirect back to login
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        json: {
          user: { id: "user-001", email: "test@mammoth.ai", name: "E2E Tester" },
          session: { id: "sess-001" },
        },
      })
    );

    await page.goto("/login");
  });

  test("renders email and password fields", async ({ page }) => {
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("shows error when fields are empty and form is submitted", async ({ page }) => {
    await page.getByRole("button", { name: /sign in/i }).click();
    // Browser-native required field validation or app-level error
    const emailField = page.getByLabel("Email");
    const isInvalid = await emailField.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test("shows error message on wrong credentials", async ({ page }) => {
    await page.getByLabel("Email").fill("wrong@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/invalid|incorrect|wrong|error/i)).toBeVisible();
  });

  test("redirects to /dashboard on successful login", async ({ page }) => {
    // Mock all API routes dashboard will need
    await page.route("**/api/v1/**", (route) => route.fulfill({ json: ok([]) }));

    await page.getByLabel("Email").fill("test@mammoth.ai");
    await page.getByLabel("Password").fill("TestPass123!");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  });

  test("has a link to /signup", async ({ page }) => {
    await page.getByRole("link", { name: /sign up|create account/i }).click();
    await expect(page).toHaveURL(/signup/);
  });
});

test.describe("Auth — Signup (/signup)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/sign-up/email", async (route) => {
      return route.fulfill({
        json: {
          user: { id: "user-new", email: "new@mammoth.ai", name: "New User" },
          session: { id: "sess-new" },
        },
      });
    });

    await page.goto("/signup");
  });

  test("renders name, email, and password fields", async ({ page }) => {
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /create account|sign up/i })).toBeVisible();
  });

  test("redirects to /onboarding after successful signup", async ({ page }) => {
    await page.getByLabel("Name").fill("New User");
    await page.getByLabel("Email").fill("new@mammoth.ai");
    await page.getByLabel("Password").fill("TestPass123!");
    await page.getByRole("button", { name: /create account|sign up/i }).click();
    await expect(page).toHaveURL(/onboarding/, { timeout: 10_000 });
  });

  test("has a link back to /login", async ({ page }) => {
    await page.getByRole("link", { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/login/);
  });
});

test.describe("Auth — Route protection", () => {
  test("unauthenticated user visiting /dashboard is redirected to /login", async ({ page }) => {
    // No session cookie — should redirect
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/login/, { timeout: 10_000 });
  });

  test("unauthenticated user visiting /goals is redirected to /login", async ({ page }) => {
    await page.goto("/goals");
    await expect(page).toHaveURL(/login/, { timeout: 10_000 });
  });
});
