import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup/vitest.setup.ts"],
    // Isolate each test file in its own worker so vi.mock() factories don't
    // bleed across test files that need different DB return values.
    isolate: true,
    // Clear all mocks between tests — prevents state leaking from one test to the next.
    clearMocks: true,
  },
});
