import { mkdirSync, writeFileSync } from "node:fs";
import { test as setup } from "@playwright/test";
import { login, PHONE_ROLES, STATE } from "./helpers";

// One login per role for the whole run; tests reuse the saved session.
setup("log in once per role", async ({ page }) => {
  mkdirSync("e2e/.auth", { recursive: true });
  if (!process.env.E2E_DB) {
    for (const file of Object.values(STATE)) writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  for (const [role, file] of Object.entries(STATE)) {
    await page.context().clearCookies();
    await login(page, role, PHONE_ROLES.has(role) ? /\/use-the-app$/ : /\/home$/);
    await page.context().storageState({ path: file });
  }
});
