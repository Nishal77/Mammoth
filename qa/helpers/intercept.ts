import { Page, Route } from "@playwright/test";
import { ok, MOCK_COMPANY, MOCK_GOAL, MOCK_APPROVAL, MOCK_DEPARTMENT, MOCK_MEMORY } from "../data/mock-api";

/**
 * Intercepts all /api/v1/* requests and returns mock data.
 *
 * Call this at the start of any test that renders authenticated pages.
 * The real Fastify backend does NOT need to be running.
 *
 * Why mock instead of hitting real API?
 * - Tests are fast and deterministic (no DB, no network)
 * - No test data cleanup needed after each run
 * - Works in CI without any services running
 */
export async function mockAllApiRoutes(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    // ── Companies ─────────────────────────────────────────────────────────────
    if (url.includes("/api/v1/companies") && method === "GET" && !url.includes("/goals") && !url.includes("/approvals")) {
      return route.fulfill({ json: ok([MOCK_COMPANY]) });
    }

    // ── Goals ─────────────────────────────────────────────────────────────────
    if (url.includes("/goals") && method === "GET") {
      return route.fulfill({ json: ok([MOCK_GOAL]) });
    }
    if (url.includes("/goals") && method === "POST") {
      return route.fulfill({ status: 201, json: ok({ ...MOCK_GOAL, id: "goal-new-001" }) });
    }

    // ── Approvals ─────────────────────────────────────────────────────────────
    if (url.includes("/approvals") && method === "GET") {
      return route.fulfill({ json: ok([MOCK_APPROVAL]) });
    }
    if (url.includes("/approvals") && (method === "POST" || method === "PATCH")) {
      return route.fulfill({ json: ok({ ...MOCK_APPROVAL, status: "approved" }) });
    }

    // ── Departments ────────────────────────────────────────────────────────────
    if (url.includes("/departments") && method === "GET") {
      return route.fulfill({ json: ok([MOCK_DEPARTMENT]) });
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    if (url.includes("/memory") && method === "GET") {
      return route.fulfill({ json: ok([MOCK_MEMORY]) });
    }

    // ── Dashboard metrics ─────────────────────────────────────────────────────
    if (url.includes("/metrics") && method === "GET") {
      return route.fulfill({
        json: ok({ mrr: 25000, activeGoals: 1, pendingApprovals: 1, agentRuns: 42 }),
      });
    }

    // ── Onboarding ────────────────────────────────────────────────────────────
    if (url.includes("/onboarding/start") && method === "POST") {
      return route.fulfill({ json: ok({ sessionId: "sess-e2e-001", nextStep: "company_details" }) });
    }
    if (url.includes("/onboarding") && url.includes("/step") && method === "PATCH") {
      return route.fulfill({ json: ok({ sessionId: "sess-e2e-001", nextStep: "brand_voice" }) });
    }
    if (url.includes("/onboarding") && url.includes("/complete") && method === "POST") {
      return route.fulfill({ json: ok({ companyId: MOCK_COMPANY.id }) });
    }

    // ── Integrations ──────────────────────────────────────────────────────────
    if (url.includes("/integrations") && method === "GET") {
      return route.fulfill({ json: ok([]) });
    }

    // ── Auth (better-auth routes) ─────────────────────────────────────────────
    if (url.includes("/api/auth/get-session")) {
      return route.fulfill({
        json: {
          user: { id: "user-e2e-001", email: "test@mammoth.ai", name: "E2E Tester" },
          session: { id: "sess-001", expiresAt: new Date(Date.now() + 86400000).toISOString() },
        },
      });
    }

    // Fallthrough — let unmatched routes hit the real server
    await route.continue();
  });
}
