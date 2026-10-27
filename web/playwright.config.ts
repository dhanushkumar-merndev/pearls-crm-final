import { defineConfig, devices } from "@playwright/test";

// Uncommon port, never reused: a busy port fails loudly instead of testing another app.
const PORT = 3417;

/**
 * E2E_HEADED=1: watch the run in real browser windows (Playwright's own Chromium, a fresh
 * profile: nothing from your browser). E2E_SCREEN_X puts them on a screen, e.g. 0 = the left
 * one; each worker's window is moved a little so they don't hide each other. The windows take
 * the mouse and keyboard focus while they run.
 */
const HEADED = Boolean(process.env.E2E_HEADED);
const worker = Number(process.env.TEST_WORKER_INDEX ?? 0);
const headedArgs = HEADED
  ? ["--ozone-platform=x11", `--window-position=${Number(process.env.E2E_SCREEN_X ?? 0) + (worker % 3) * 300},${(worker % 3) * 60}`, "--window-size=1280,900"]
  : [];

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
  expect: {
    // Logged-in tests wait on the online (free) staging project: a save + reload can take over 5 s
    // while three browsers share it.
    timeout: process.env.E2E_DB ? 10_000 : 5_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  // channel "chromium" = full Chromium in new headless mode (no separate headless-shell download).
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { channel: "chromium", headless: !HEADED, launchOptions: { args: headedArgs } } },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /phone-layout\.db\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        viewport: { width: 1280, height: 800 },
        headless: !HEADED,
        launchOptions: { args: headedArgs },
      },
    },
    // Phone width (390 × 844, a common Android/iPhone size): the layout checks in phone-layout.db.spec.ts.
    {
      name: "phone",
      dependencies: ["setup"],
      testMatch: /phone-layout\.db\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        headless: !HEADED,
        launchOptions: { args: headedArgs },
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
