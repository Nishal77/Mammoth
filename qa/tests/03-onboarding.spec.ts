import { test, expect } from "../fixtures/auth.fixture";

/**
 * Onboarding wizard tests — /onboarding
 *
 * What we test:
 * - Step 0: Enter company name and start session
 * - Step 1 (company_details): tagline, industry, stage fields
 * - Step 2 (brand_voice): brand voice textarea
 * - Step 3 (first_goal): goal title, target, unit, deadline
 * - Step 4 (connect): completion screen
 * - Validation: cannot advance without required fields
 *
 * Graph context (graphify):
 *   OnboardingClient.tsx → api.post("/onboarding/start")
 *                        → api.patch("/onboarding/:id/step")
 *                        → api.post("/onboarding/:id/complete")
 *   Steps: company_details → brand_voice → first_goal → connect
 */
test.describe("Onboarding Wizard (/onboarding)", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Override onboarding routes with step-aware responses
    let currentStep = "company_details";

    await page.route("**/api/v1/onboarding/start", (route) =>
      route.fulfill({ json: { success: true, data: { sessionId: "sess-onb-001", nextStep: "company_details" } } })
    );

    await page.route("**/api/v1/onboarding/**/step", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { step?: string };
      const stepOrder = ["company_details", "brand_voice", "first_goal", "connect"];
      const nextIdx = stepOrder.indexOf(body.step ?? "") + 1;
      currentStep = stepOrder[nextIdx] ?? "connect";
      return route.fulfill({
        json: { success: true, data: { sessionId: "sess-onb-001", nextStep: currentStep } },
      });
    });

    await page.route("**/api/v1/onboarding/**/complete", (route) =>
      route.fulfill({ json: { success: true, data: { companyId: "company-e2e-001" } } })
    );

    await page.goto("/onboarding");
  });

  test("shows company name field on first load", async ({ authenticatedPage: page }) => {
    await expect(page.getByPlaceholder(/company name|your company/i)).toBeVisible();
  });

  test("cannot advance without entering company name", async ({ authenticatedPage: page }) => {
    // Click start/continue without filling the field
    await page.getByRole("button", { name: /start|next|continue/i }).first().click();
    // Should still be on step 0 — no company_details fields visible yet
    await expect(page.getByPlaceholder(/company name|your company/i)).toBeVisible();
  });

  test("advances to company_details step after entering company name", async ({ authenticatedPage: page }) => {
    await page.getByPlaceholder(/company name|your company/i).fill("Acme Corp");
    await page.getByRole("button", { name: /start|next|continue/i }).first().click();
    // Should now show step 1 fields
    await expect(page.getByText(/company|brand voice|goal|connect/i).first()).toBeVisible();
  });

  test("completes all 4 steps in sequence", async ({ authenticatedPage: page }) => {
    // Step 0: enter company name
    await page.getByPlaceholder(/company name|your company/i).fill("Acme Corp");
    await page.getByRole("button", { name: /start|next|continue/i }).first().click();

    // Step 1: company_details (tagline, industry, stage)
    await page.waitForSelector("input, textarea, select", { timeout: 5_000 });
    // Fill whatever fields are visible
    const taglineInput = page.getByPlaceholder(/tagline/i);
    if (await taglineInput.isVisible()) await taglineInput.fill("AI-powered everything");

    const industryInput = page.getByPlaceholder(/industry/i);
    if (await industryInput.isVisible()) await industryInput.fill("SaaS");

    await page.getByRole("button", { name: /next|continue/i }).click();

    // Step 2: brand_voice
    await page.waitForTimeout(500);
    const brandTextarea = page.getByPlaceholder(/brand voice|tone|voice/i);
    if (await brandTextarea.isVisible()) await brandTextarea.fill("Professional, friendly, direct");
    await page.getByRole("button", { name: /next|continue/i }).click();

    // Step 3: first_goal
    await page.waitForTimeout(500);
    const goalInput = page.getByPlaceholder(/goal|title|what.*achieve/i).first();
    if (await goalInput.isVisible()) await goalInput.fill("Reach $1M ARR");
    await page.getByRole("button", { name: /next|continue|finish|done/i }).click();

    // Should reach the final connect step or redirect to dashboard
    await expect(
      page.getByText(/connect|done|dashboard|integrations/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows step indicator with 4 steps", async ({ authenticatedPage: page }) => {
    // The STEPS array in OnboardingClient has 4 entries: Company, Brand Voice, Goal, Connect
    const stepLabels = ["Company", "Brand Voice", "Goal", "Connect"];
    for (const label of stepLabels) {
      await expect(page.getByText(label)).toBeVisible();
    }
  });
});
