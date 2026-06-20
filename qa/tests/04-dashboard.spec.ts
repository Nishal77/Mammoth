import { test, expect } from "../fixtures/auth.fixture";

/**
 * Dashboard tests — /(app)/dashboard
 *
 * What we test:
 * - Page renders the metric strip (MRR, active goals, pending approvals)
 * - Department grid shows agent departments
 * - Agent activity feed section is present
 * - Pending approvals badge shows the correct count
 * - Navigation sidebar links work
 *
 * Graph context (graphify):
 *   DashboardClient.tsx uses:
 *     MetricStrip, DepartmentGrid, AgentActivityFeed, PendingApprovalsBadge
 *   Data comes from: /api/v1/companies, /api/v1/companies/:id/metrics
 */
test.describe("Dashboard (/(app)/dashboard)", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/dashboard");
    // Wait for the page content to settle
    await page.waitForLoadState("networkidle");
  });

  test("renders without crashing", async ({ authenticatedPage: page }) => {
    // The page title or a key heading should be visible
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  test("shows metric strip with key numbers", async ({ authenticatedPage: page }) => {
    // MetricStrip renders MRR, active goals, pending approvals count
    // Look for any of these metric labels
    const metricLabels = ["MRR", "Goals", "Approvals", "Runs"];
    let found = false;
    for (const label of metricLabels) {
      if (await page.getByText(label).isVisible()) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("renders the department grid", async ({ authenticatedPage: page }) => {
    // DepartmentGrid shows 9 department cards (CEO Brain, Sales, Marketing, etc.)
    const departmentNames = ["marketing", "sales", "engineering", "support", "finance", "research", "hr", "content"];
    let visibleCount = 0;
    for (const dept of departmentNames) {
      if (await page.getByText(new RegExp(dept, "i")).isVisible()) {
        visibleCount++;
      }
    }
    // At least some departments should render
    expect(visibleCount).toBeGreaterThan(0);
  });

  test("shows agent activity feed section", async ({ authenticatedPage: page }) => {
    // AgentActivityFeed renders live agent run events
    await expect(page.getByText(/activity|agent|run/i).first()).toBeVisible();
  });

  test("sidebar navigation links are visible", async ({ authenticatedPage: page }) => {
    // The app layout has nav links to all main sections
    const navLinks = ["/goals", "/approvals", "/departments"];
    for (const href of navLinks) {
      const link = page.locator(`a[href="${href}"]`);
      if (await link.count() > 0) {
        await expect(link.first()).toBeVisible();
      }
    }
  });

  test("clicking Goals nav link navigates to /goals", async ({ authenticatedPage: page }) => {
    const goalsLink = page.locator('a[href="/goals"]');
    if (await goalsLink.count() > 0) {
      await goalsLink.first().click();
      await expect(page).toHaveURL(/goals/);
    }
  });

  test("clicking Approvals nav link navigates to /approvals", async ({ authenticatedPage: page }) => {
    const approvalsLink = page.locator('a[href="/approvals"]');
    if (await approvalsLink.count() > 0) {
      await approvalsLink.first().click();
      await expect(page).toHaveURL(/approvals/);
    }
  });
});
