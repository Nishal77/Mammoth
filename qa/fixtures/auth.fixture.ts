import { test as base, Page } from "@playwright/test";
import { mockAllApiRoutes } from "../helpers/intercept";

/**
 * Custom fixtures that extend Playwright's built-in `test`.
 *
 * WHY fixtures?
 * Without fixtures, every test would repeat the same login steps.
 * Fixtures run setup once and inject the ready-to-use page into each test.
 *
 * Usage in a spec file:
 *   import { test } from "../fixtures/auth.fixture";
 *   test("my test", async ({ authenticatedPage }) => { ... });
 */

type AuthFixtures = {
  /** A page that is already logged in and has API mocks active */
  authenticatedPage: Page;
  /** A page with API mocks but NOT logged in */
  publicPage: Page;
};

export const test = base.extend<AuthFixtures>({
  // Authenticated page: mock API routes + inject a session cookie so the app
  // thinks the user is logged in without hitting a real auth server.
  authenticatedPage: async ({ page }, use) => {
    // Intercept all /api/v1/* routes before any navigation
    await mockAllApiRoutes(page);

    // Inject a fake better-auth session cookie.
    // The web app reads this via useSession() on the client.
    await page.context().addCookies([
      {
        name: "better-auth.session_token",
        value: "e2e-test-session-token",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
      },
    ]);

    await use(page);
  },

  // Public page: only mock the API, no session cookie
  publicPage: async ({ page }, use) => {
    await mockAllApiRoutes(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
