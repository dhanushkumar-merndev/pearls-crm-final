import { expect, test, type Page } from "@playwright/test";

// Phase 1: admin setup. Needs the local backend with seed data (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the local Supabase backend (E2E_DB=1)");

const PASSWORD = process.env.E2E_PASSWORD ?? "Pearl@2026";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test("admin adds a doctor, sets hours, and an overlap is refused", async ({ page }) => {
  const name = `Dr E2E ${Date.now()}`;
  await login(page, "admin");
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Admin" }).click();
  await page.getByRole("link", { name: /Doctors/ }).click();
  await page.getByRole("button", { name: "Add doctor" }).click();
  await page.getByLabel("Doctor's full name").fill(name);
  await page.getByLabel("Consultation fee").fill("600");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved ✓")).toBeVisible();

  await page.getByLabel("Search Doctors").fill(name);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("₹600.00");
  await row.getByRole("link", { name: "Hours & leave" }).click();

  await page.getByLabel("Day").selectOption({ label: "Monday" });
  await page.getByLabel("From").first().fill("10:00");
  await page.getByLabel("To").first().fill("13:00");
  await page.getByRole("button", { name: "Add hours" }).click();
  await expect(page.getByRole("cell", { name: "Monday" })).toBeVisible();

  await page.getByLabel("From").first().fill("12:00");
  await page.getByLabel("To").first().fill("14:00");
  await page.getByRole("button", { name: "Add hours" }).click();
  await expect(page.getByText("This overlaps with an existing entry")).toBeVisible();
});

test("admin adds a service and finds it in the change history", async ({ page }) => {
  const name = `E2E Service ${Date.now()}`;
  await login(page, "admin");
  await page.goto("/admin/libraries/services");
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Price").fill("1500");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved ✓")).toBeVisible();
  await page.goto("/admin/audit");
  await page.getByLabel("What").selectOption({ label: "Services" });
  await expect(page.getByText(name).first()).toBeVisible();
});

test("a receptionist can't open admin pages", async ({ page }) => {
  await login(page, "reception");
  await expect(page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.goto("/admin/settings");
  await expect(page.getByText("This page doesn't exist.")).toBeVisible();
});

test("staff change their own password", async ({ page }) => {
  await login(page, "reception2");
  await page.goto("/account/password");
  await page.getByLabel("Current password").fill("wrong-password-9");
  await page.getByLabel("New password", { exact: true }).fill("NewPass2026");
  await page.getByLabel("Type the new password again").fill("NewPass2026");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The current password is not right.")).toBeVisible();
});
