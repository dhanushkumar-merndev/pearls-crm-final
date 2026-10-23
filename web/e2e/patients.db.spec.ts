import { expect, test, type Page } from "@playwright/test";

// Phase 2: the three registration paths and search. Needs the local backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the local Supabase backend (E2E_DB=1)");

const PASSWORD = process.env.E2E_PASSWORD ?? "Pearl@2026";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("reception");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

// A unique, valid Indian mobile per test run.
const phone = () => `9${String(Date.now()).slice(-9)}`;

async function registerNew(page: Page, name: string, mobile: string) {
  await page.goto("/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Save patient" }).first().click();
}

test("desk registration: a new patient gets a UHID and a patient file", async ({ page }) => {
  await login(page);
  const name = `E2E New ${Date.now()}`;
  await registerNew(page, name, phone());
  await expect(page.getByText(/Registered ✓ — UHID/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
});

test("same phone again: update only the ticked details, or add a family member", async ({ page }) => {
  await login(page);
  const mobile = phone();
  const name = `E2E Dup ${Date.now()}`;
  await registerNew(page, name, mobile);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  // Same phone, different name and a city → reception must choose.
  await page.goto("/patients/new");
  await page.getByLabel("Full name").fill(`${name} Changed`);
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("City").fill("Mysuru");
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { name: "This person may already be registered" })).toBeVisible();
  await page.getByRole("button", { name: "Same person…" }).click();
  await page.getByLabel("City").check();
  await page.getByRole("button", { name: /Update 1 detail/ }).click();
  await expect(page.getByText(/Updated ✓/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name); // the name was NOT overwritten

  // And a family member on the same phone.
  await page.goto("/patients/new");
  await page.getByLabel("Full name").fill(`${name} Child`);
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await page.getByRole("button", { name: "Family member" }).first().click();
  await expect(page.getByText(/Registered ✓/)).toBeVisible();
  await page.getByRole("tab", { name: /Family/ }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("Ctrl+K finds a patient by phone", async ({ page }) => {
  await login(page);
  const mobile = phone();
  const name = `E2E Find ${Date.now()}`;
  await registerNew(page, name, mobile);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.goto("/home");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search name, phone or UHID…").last().fill(mobile.slice(-6));
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
});
