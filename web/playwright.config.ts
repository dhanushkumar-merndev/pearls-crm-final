import { defineConfig, devices } from "@playwright/test";

// Uncommon port, never reused: a busy port fails loudly instead of testing another app.
const PORT = 3417;

/**
 * Browser tests. Tests in e2e/*.db.spec.ts need the local backend (pnpm db:start)
 * and run only when E2E_DB=1. The rest run without a backend.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // On CI the "github" reporter turns failures into annotations, readable without logging in to GitHub.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  // channel "chromium" = full Chromium in new headless mode (no separate headless-shell download).
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
