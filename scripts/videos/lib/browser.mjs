// Shared browser setup for the video recorder and quick probes. Headless only (no window on screen).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../../..");
const require = createRequire(path.join(ROOT, "web/package.json"));
const { chromium: base } = require("@playwright/test");
// Local Edge Functions sign storage URLs for host.docker.internal (they run in Docker): the browser maps it home.
export const chromium = {
  launch: (o = {}) => base.launch({ ...o, args: [...(o.args ?? []), "--host-resolver-rules=MAP host.docker.internal 127.0.0.1"] }),
};

export const BASE = process.env.VIDEO_BASE ?? "http://127.0.0.1:3418";
export const PASSWORD = "Pearl@2026"; // fake local logins (supabase/seed/01_users.sql)

/** 1440 × 810 CSS pixels drawn at 4/3 → crisp 1920 × 1080 frames. */
export async function newPage(browser, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 810 },
    deviceScaleFactor: opts.scale ?? 4 / 3,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    colorScheme: "dark",
    hasTouch: opts.hasTouch ?? false,
  });
  return context.newPage();
}

export async function login(page, username) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).first().fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}
