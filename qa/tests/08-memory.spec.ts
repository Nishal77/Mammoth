import { test, expect } from "../fixtures/auth.fixture";
import { ok, MOCK_MEMORY } from "../data/mock-api";

/**
 * Memory page tests — /(app)/memory
 *
 * What we test:
 * - Memory entries are listed by type (identity, brand, customer, competitor, decision)
 * - Memory content is readable
 * - Empty state is shown when no memory exists
 *
 * Graph context (graphify):
 *   MemoryClient.tsx → api.get("/companies/:id/memory")
 *   Memory types: identity | brand | customer | competitor | decision
 *   Stored in companyMemory table (Drizzle) + Qdrant vector store
 */
test.describe("Memory Page (/(app)/memory)", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.route("**/api/v1/companies/**/memory", (route) =>
      route.fulfill({
        json: ok([
          { ...MOCK_MEMORY, type: "identity", content: "Acme Corp builds AI-powered workflow tools" },
          { ...MOCK_MEMORY, id: "mem-002", type: "brand", content: "Tone: professional, friendly, direct" },
          { ...MOCK_MEMORY, id: "mem-003", type: "customer", content: "SMB founders struggling with ops overhead" },
          { ...MOCK_MEMORY, id: "mem-004", type: "competitor", content: "Notion AI, Monday.com, ClickUp" },
          { ...MOCK_MEMORY, id: "mem-005", type: "decision", content: "Chose Temporal for long-running workflows" },
        ]),
      })
    );

    await page.goto("/memory");
    await page.waitForLoadState("networkidle");
  });

  test("renders memory entries", async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/Acme Corp builds AI-powered/i)).toBeVisible({ timeout: 8_000 });
  });

  test("shows all 5 memory types", async ({ authenticatedPage: page }) => {
    const types = ["identity", "brand", "customer", "competitor", "decision"];
    for (const type of types) {
      await expect(page.getByText(new RegExp(type, "i")).first()).toBeVisible();
    }
  });

  test("shows memory content inline", async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/professional, friendly, direct/i)).toBeVisible();
  });

  test("shows empty state when no memory exists", async ({ authenticatedPage: page }) => {
    await page.route("**/api/v1/companies/**/memory", (route) =>
      route.fulfill({ json: ok([]) })
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/no memory|empty|no entries/i)).toBeVisible();
  });
});
