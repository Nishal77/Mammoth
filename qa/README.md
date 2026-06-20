# QA — Playwright E2E Tests

End-to-end browser tests for the MAMMOTH web app.
Tests cover every user-facing page from landing to settings.

---

## Folder structure

```
qa/
├── tests/               One spec file per page, numbered for clarity
│   ├── 01-landing.spec.ts
│   ├── 02-auth.spec.ts          login · signup · route protection
│   ├── 03-onboarding.spec.ts    4-step wizard
│   ├── 04-dashboard.spec.ts     metrics · departments · activity feed
│   ├── 05-goals.spec.ts         list · create · empty state
│   ├── 06-approvals.spec.ts     ring badges · approve · reject · modify
│   ├── 07-departments.spec.ts   9 agent departments
│   ├── 08-memory.spec.ts        5 memory types
│   ├── 09-integrations.spec.ts  OAuth connect / disconnect
│   └── 10-settings.spec.ts      company name · delete confirmation
│
├── fixtures/
│   └── auth.fixture.ts          authenticatedPage + publicPage fixtures
│
├── helpers/
│   ├── intercept.ts             mocks all /api/v1/* routes
│   └── auth-helper.ts           loginViaUI · signupViaUI · logoutViaUI
│
├── data/
│   └── mock-api.ts              canonical mock responses (MOCK_USER, MOCK_GOAL …)
│
├── playwright.config.ts         browser config · webServer · reporters
└── tsconfig.json
```

---

## How mocking works

All tests intercept `/api/v1/*` requests with `page.route()`.
**No real backend or database is needed to run these tests.**

The mock responses live in `data/mock-api.ts`.
When the real API contract changes, update that file to match.

---

## Running tests

```bash
# install dependencies (first time only)
cd qa && pnpm install

# install Playwright browsers (first time only)
pnpm exec playwright install --with-deps chromium

# run all tests (headless)
pnpm test

# run with a visible browser window
pnpm test:headed

# open the interactive Playwright UI
pnpm test:ui

# debug a single test
pnpm test:debug tests/05-goals.spec.ts

# view the HTML report after a run
pnpm test:report
```

> The Next.js dev server starts automatically before tests run.
> You do NOT need to start it manually.

---

## Adding a new test

1. Create `tests/11-my-page.spec.ts`
2. Import `test, expect` from `../fixtures/auth.fixture`
3. Mock any new API routes via `page.route()` inside `beforeEach`
4. Write `test("what it should do", async ({ authenticatedPage: page }) => { ... })`
5. Use `authenticatedPage` for logged-in pages, `publicPage` for public ones

---

## CI integration

Tests run in GitHub Actions on every push to `main`.
See `.github/workflows/ci.yml` — add this job:

```yaml
e2e:
  name: E2E Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with:
        version: 9.14.4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm exec playwright install --with-deps chromium
    - run: pnpm --filter @mammoth/qa test
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: qa/playwright-report/
        retention-days: 7
```
