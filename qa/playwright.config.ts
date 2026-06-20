import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for MAMMOTH E2E tests.
 *
 * Tests run against the Next.js dev server on port 3000.
 * All API calls to /api/v1 are intercepted by fixtures — no real backend needed.
 * See qa/fixtures/auth.fixture.ts for how authentication state is mocked.
 */
export default defineConfig({
  // Where the tests live
  testDir: "./tests",

  // Run each test file in parallel; tests within a file run sequentially
  fullyParallel: true,

  // Fail CI if you accidentally left test.only() in a spec
  forbidOnly: !!process.env["CI"],

  // Retry failed tests once in CI to catch flaky network timing
  retries: process.env["CI"] ? 1 : 0,

  // One worker in CI to avoid port conflicts; all cores locally
  workers: process.env["CI"] ? 1 : undefined,

  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["list"],
  ],

  use: {
    // Base URL so tests can use relative paths like page.goto("/login")
    baseURL: process.env["BASE_URL"] ?? "http://localhost:3000",

    // Record a trace on first retry so you can see exactly what failed
    trace: "on-first-retry",

    // Screenshot only on failure
    screenshot: "only-on-failure",

    // All API calls use cookies for auth
    extraHTTPHeaders: { "Content-Type": "application/json" },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Auto-start the Next.js dev server before tests run
  webServer: {
    command: "pnpm --filter @mammoth/web dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
