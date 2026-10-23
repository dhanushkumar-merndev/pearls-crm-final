import { expect, test } from "@playwright/test";
import { open, STATE } from "./helpers";

// Phase 1: admin setup. Needs a backend with seed data (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

test.describe("as admin", () => {
  test.use({ storageState: STATE.admin });

  test("admin adds a doctor, sets hours, and an overlap is refused", async ({ page }) => {
    const name = `Dr E2E ${Date.now()}`;
    await open(page, "/home");
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

    await page.getByLabel("Day", { exact: true }).selectOption({ label: "Monday" });
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
    await open(page, "/admin/libraries/services");
    await page.getByRole("button", { name: "Add service" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Price").fill("1500");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved ✓")).toBeVisible();
    await open(page, "/admin/audit");
    await page.getByLabel("What").selectOption({ label: "Services" });
    await expect(page.getByText(name).first()).toBeVisible();
  });
});

test.describe("as receptionist", () => {
  test.use({ storageState: STATE.reception });

  test("a receptionist can't open admin pages", async ({ page }) => {
    await open(page, "/home");
    await expect(page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Admin" })).toHaveCount(0);
    await page.goto("/admin/settings");
    await expect(page.getByText("This page doesn't exist.")).toBeVisible();
  });

  test("staff change their own password (the current one is checked)", async ({ page }) => {
    await open(page, "/account/password");
    await page.getByLabel("Current password").fill("wrong-password-9");
    await page.getByLabel("New password", { exact: true }).fill("NewPass2026");
    await page.getByLabel("Type the new password again").fill("NewPass2026");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The current password is not right.")).toBeVisible();
  });
});
