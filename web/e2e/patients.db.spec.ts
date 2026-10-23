import { expect, test, type Page } from "@playwright/test";
import { open, STATE, uniquePhone } from "./helpers";

// Phase 2: the three registration paths and search. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

async function registerNew(page: Page, name: string, mobile: string) {
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Save patient" }).first().click();
}

test("desk registration: a new patient gets a UHID and a patient file", async ({ page }) => {
  const name = `E2E New ${Date.now()}`;
  await registerNew(page, name, uniquePhone());
  await expect(page.getByText(/Registered ✓ — UHID/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
});

test("same phone again: update only the ticked details, or add a family member", async ({ page }) => {
  const mobile = uniquePhone();
  const name = `E2E Dup ${Date.now()}`;
  await registerNew(page, name, mobile);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  // Same phone, different name and a city → reception must choose.
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(`${name} Changed`);
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("City").fill("Mysuru");
  await page.getByRole("button", { name: "Save patient" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "This person may already be registered" })).toBeVisible();
  await dialog.getByRole("button", { name: "Same person…" }).click();
  await dialog.getByLabel("City").check();
  await dialog.getByRole("button", { name: /Update 1 detail/ }).click();
  await expect(page.getByText(/Updated ✓/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name); // the name was NOT overwritten

  // And a family member on the same phone.
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(`${name} Child`);
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Family member" }).click();
  await expect(page.getByText(/Registered ✓/)).toBeVisible();
  await page.getByRole("tab", { name: /Family/ }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("Ctrl+K finds a patient by phone", async ({ page }) => {
  const mobile = uniquePhone();
  const name = `E2E Find ${Date.now()}`;
  await registerNew(page, name, mobile);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await open(page, "/home");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search name, phone or UHID…").last().fill(mobile.slice(-6));
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
});
