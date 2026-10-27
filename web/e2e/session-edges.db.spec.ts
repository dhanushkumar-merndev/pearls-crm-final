import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { open, rpcAs, STATE, uniquePhone } from "./helpers";

// W-ACC-10…14: the server out of reach, and Ctrl+K for each role (TEST_CASES.md). Idle logout,
// a deactivated person and two tabs editing are in admin-setup.db.spec.ts.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

test.describe("server out of reach", () => {
  test.describe("logged out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("login says the connection is the problem, not the password", async ({ page }) => {
      await page.route("**/auth/v1/token**", (route) => route.abort("internetdisconnected"));
      await page.goto("/login");
      await page.getByLabel("Username").fill("reception");
      await page.getByLabel("Password", { exact: true }).fill("Wrong-but-unsent-1");
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.locator("#login-error")).toContainText("Can't reach the server");
    });
  });

  test.describe("signed in", () => {
    test.use({ storageState: STATE.admin });

    test("a list that can't load says so and offers no stale data", async ({ page }) => {
      await open(page, "/admin/libraries/rooms");
      await page.route("**/rest/v1/**", (route) => route.abort("internetdisconnected"));
      await page.reload();
      await expect(page.getByText("Couldn't load. Check the internet connection and try again.")).toBeVisible({ timeout: 30_000 });
    });
  });
});

test.describe("Ctrl+K", () => {
  test.describe("reception", () => {
    test.use({ storageState: STATE.reception });

    test("finds a patient by UHID-less phone digits and opens the file", async ({ page }) => {
      const name = `E2E CtrlK ${Date.now()}`;
      const phone = uniquePhone();
      await open(page, "/patients/new");
      await page.getByLabel("Full name").fill(name);
      await page.getByLabel("Mobile number").fill(phone);
      await page.getByRole("button", { name: "Save patient" }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      await open(page, "/home");
      await page.keyboard.press("Control+k");
      const search = page.getByPlaceholder("Search name, phone, UHID or lead no.…").last();
      await expect(search).toBeFocused();
      await search.fill(phone);
      await page.getByRole("option", { name: new RegExp(name) }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    });
  });

  test.describe("sales manager", () => {
    test.use({ storageState: STATE.manager });

    test("finds a lead by phone and opens it; reception pages aren't offered", async ({ page }) => {
      const name = `E2E CtrlK Lead ${Date.now()}`;
      const phone = uniquePhone();
      await open(page, "/home");
      await rpcAs(page, "create_lead", { p_lead: { name, phone: `+91${phone}`, force: true, via: "web" }, p_client_id: randomUUID() });
      await page.keyboard.press("Control+k");
      const search = page.getByPlaceholder("Search name, phone, UHID or lead no.…").last();
      await search.fill("Patients");
      await expect(page.getByRole("option", { name: /^Patients$/ })).toHaveCount(0);
      await search.fill(phone);
      await page.getByRole("option", { name: new RegExp(name) }).first().click();
      await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    });
  });
});
