import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke tests against the production build. No API key: the agent route is stubbed
// in the one test that needs it, so these never spend credits.
// E2E_PORT lets two checkouts run the suite side by side.
const PORT = Number(process.env.E2E_PORT ?? 4318);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "ipad",
      testIgnore: /touch\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1180, height: 820 } },
    },
    {
      name: "desktop",
      testIgnore: /touch\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // coarse pointer at iPad landscape: touch-target sizes only (not the whole suite)
      name: "touch",
      testMatch: /touch\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 820 },
        hasTouch: true,
        isMobile: false,
      },
    },
  ],
  webServer: {
    command: "node dist/server/index.js",
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT), ANTHROPIC_API_KEY: "" },
    timeout: 30_000,
  },
});
