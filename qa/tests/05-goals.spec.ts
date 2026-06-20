import { test, expect } from "../fixtures/auth.fixture";
import { ok, MOCK_GOAL } from "../data/mock-api";

/**
 * Goals page tests — /(app)/goals
 *
 * What we test:
 * - Existing goals are displayed as GoalCards
 * - "Create goal" form opens when button is clicked
 * - Form validates required fields
 * - Submitting a valid goal calls POST /companies/:id/goals
 * - New goal appears in the list after creation
 * - Empty state is shown when no goals exist
 *
 * Graph context (graphify):
 *   GoalsClient.tsx → api.get("/companies/:id/goals") → GoalCard[]
 *                   → api.post("/companies/:id/goals") on form submit
 */
test.describe("Goals Page (/(app)/goals)", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/goals");
    await page.waitForLoadState("networkidle");
  });

  test("renders existing goal cards", async ({ authenticatedPage: page }) => {
    // MOCK_GOAL title is "Reach $1M ARR"
    await expect(page.getByText("Reach $1M ARR")).toBeVisible({ timeout: 8_000 });
  });

  test("shows goal type and status on the card", async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/revenue|users|other/i)).toBeVisible();
    await expect(page.getByText(/active|paused|complete/i)).toBeVisible();
  });

  test("shows a create goal button", async ({ authenticatedPage: page }) => {
    await expect(page.getByRole("button", { name: /new goal|create|add goal/i })).toBeVisible();
  });

  test("opens create goal form when button is clicked", async ({ authenticatedPage: page }) => {
    await page.getByRole("button", { name: /new goal|create|add goal/i }).click();
    // The form should show title, type, target, deadline fields
    await expect(page.getByLabel(/title|goal name/i)).toBeVisible();
  });

  test("cannot submit goal form without required fields", async ({ authenticatedPage: page }) => {
    await page.getByRole("button", { name: /new goal|create|add goal/i }).click();
    await page.getByRole("button", { name: /save|create|submit/i }).click();
    // Form should not close — still visible
    await expect(page.getByLabel(/title|goal name/i)).toBeVisible();
  });

  test("creates a new goal and shows it in the list", async ({ authenticatedPage: page }) => {
    const newGoal = { ...MOCK_GOAL, id: "goal-new", title: "Double User Signups" };

    // Override the POST mock to return the new goal
    await page.route("**/api/v1/companies/**/goals", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ status: 201, json: ok(newGoal) });
      }
      // GET still returns the original list + new goal
      return route.fulfill({ json: ok([MOCK_GOAL, newGoal]) });
    });

    await page.getByRole("button", { name: /new goal|create|add goal/i }).click();
    await page.getByLabel(/title|goal name/i).fill("Double User Signups");

    // Select type if a select is present
    const typeSelect = page.getByLabel(/type/i);
    if (await typeSelect.isVisible()) await typeSelect.selectOption("users");

    await page.getByLabel(/target/i).fill("10000");
    await page.getByLabel(/deadline/i).fill("2026-12-31");
    await page.getByRole("button", { name: /save|create|submit/i }).click();

    await expect(page.getByText("Double User Signups")).toBeVisible({ timeout: 8_000 });
  });

  test("shows empty state when no goals exist", async ({ authenticatedPage: page }) => {
    // Override GET to return empty list
    await page.route("**/api/v1/companies/**/goals", (route) =>
      route.fulfill({ json: ok([]) })
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/no goals|create.*first goal|get started/i)).toBeVisible();
  });
});
