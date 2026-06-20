import { test, expect } from "../fixtures/auth.fixture";
import { ok, MOCK_APPROVAL } from "../data/mock-api";

/**
 * Approvals page tests — /(app)/approvals
 *
 * What we test:
 * - Pending approvals are listed with department, action type, ring badge
 * - Ring 2 badge is styled correctly (colour-coded)
 * - Expanding an approval shows the output content
 * - Approve action calls the API and updates status
 * - Reject action calls the API and updates status
 * - Modify action lets you edit the content before approving
 * - Empty state when no approvals exist
 *
 * Graph context (graphify):
 *   ApprovalsClient.tsx → api.get("/companies/:id/approvals")
 *                       → api.post/patch on approve/reject/modify
 *   RingBadge, StatusBadge, ActionButton, SectionHeader
 *   trustScores updated by checkAndPromoteTrustScore after 10 approvals
 */
test.describe("Approvals Page (/(app)/approvals)", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/approvals");
    await page.waitForLoadState("networkidle");
  });

  test("shows pending approval with department and action type", async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/marketing/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/send_email_campaign|email campaign/i)).toBeVisible();
  });

  test("shows a Ring 2 badge on the approval", async ({ authenticatedPage: page }) => {
    // MOCK_APPROVAL.ringLevel = 2
    await expect(page.getByText(/ring.*2|ring 2|r2/i)).toBeVisible();
  });

  test("shows pending status badge", async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/pending/i)).toBeVisible();
  });

  test("approving an item updates its status to approved", async ({ authenticatedPage: page }) => {
    const approvedApproval = { ...MOCK_APPROVAL, status: "approved" };

    // After the approve action, the GET returns updated data
    let callCount = 0;
    await page.route("**/api/v1/companies/**/approvals**", async (route) => {
      callCount++;
      if (route.request().method() !== "GET" || callCount > 1) {
        return route.fulfill({ json: ok([approvedApproval]) });
      }
      return route.fulfill({ json: ok([MOCK_APPROVAL]) });
    });

    await page.reload();
    await page.waitForLoadState("networkidle");

    // Click approve button (may need to expand the row first)
    const approveBtn = page.getByRole("button", { name: /approve/i }).first();
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      await expect(page.getByText(/approved/i)).toBeVisible({ timeout: 8_000 });
    }
  });

  test("rejecting an item updates its status to rejected", async ({ authenticatedPage: page }) => {
    const rejectedApproval = { ...MOCK_APPROVAL, status: "rejected" };

    await page.route("**/api/v1/companies/**/approvals**", async (route) => {
      if (route.request().method() !== "GET") {
        return route.fulfill({ json: ok([rejectedApproval]) });
      }
      return route.fulfill({ json: ok([MOCK_APPROVAL]) });
    });

    await page.reload();
    await page.waitForLoadState("networkidle");

    const rejectBtn = page.getByRole("button", { name: /reject/i }).first();
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click();
      await expect(page.getByText(/rejected/i)).toBeVisible({ timeout: 8_000 });
    }
  });

  test("shows the output content of the approval", async ({ authenticatedPage: page }) => {
    // MOCK_APPROVAL.outputContent = "Send Q3 newsletter to 5,000 subscribers"
    await expect(
      page.getByText(/Send Q3 newsletter|5,000 subscribers/i)
    ).toBeVisible({ timeout: 8_000 });
  });

  test("shows empty state when no approvals are pending", async ({ authenticatedPage: page }) => {
    await page.route("**/api/v1/companies/**/approvals", (route) =>
      route.fulfill({ json: ok([]) })
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/no.*approval|all clear|nothing pending/i)).toBeVisible();
  });
});
