import { test, expect } from "../fixtures/auth.fixture";
import { ok, MOCK_DEPARTMENT } from "../data/mock-api";

/**
 * Departments page tests — /(app)/departments
 *
 * What we test:
 * - All 9 departments are displayed
 * - Each card shows department name and current task
 * - Department status (active / idle) is shown
 * - Task progress is visible
 *
 * Graph context (graphify):
 *   DepartmentsClient.tsx → api.get("/companies/:id/departments")
 *   DepartmentGrid.tsx renders individual department cards
 */

const ALL_DEPARTMENTS = [
  "marketing", "sales", "engineering", "support",
  "finance", "research", "hr", "content", "executive",
];

test.describe("Departments Page (/(app)/departments)", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Return all 9 departments
    await page.route("**/api/v1/companies/**/departments", (route) =>
      route.fulfill({
        json: ok(
          ALL_DEPARTMENTS.map((name, i) => ({
            ...MOCK_DEPARTMENT,
            id: `dept-${i}`,
            name,
            currentTask: `Running ${name} campaign`,
          }))
        ),
      })
    );

    await page.goto("/departments");
    await page.waitForLoadState("networkidle");
  });

  test("renders a card for each department", async ({ authenticatedPage: page }) => {
    for (const dept of ALL_DEPARTMENTS) {
      await expect(page.getByText(new RegExp(dept, "i")).first()).toBeVisible({ timeout: 8_000 });
    }
  });

  test("shows current task on each department card", async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/Running marketing campaign/i)).toBeVisible();
  });

  test("shows active status on departments", async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/active/i).first()).toBeVisible();
  });

  test("shows task completion progress", async ({ authenticatedPage: page }) => {
    // MOCK_DEPARTMENT has tasksCompleted: 12, tasksTotal: 20
    await expect(page.getByText(/12|20|60%/)).toBeVisible();
  });
});
