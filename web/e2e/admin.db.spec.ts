import { expect, test } from "@playwright/test";
import { choose, open, pickTime, STATE } from "./helpers";

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
    // The colour is a row of swatches, not a number.
    await page.getByRole("radiogroup", { name: "Colour" }).getByRole("radio", { name: "Colour 3" }).click();
    await expect(page.getByRole("radio", { name: "Colour 3" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved ✓")).toBeVisible();

    // A new doctor goes straight to their page: details, signature, then hours.
    await expect(page).toHaveURL(/\/admin\/doctors\/[0-9a-f-]{36}\?new=1$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Doctor saved. Now set the working hours.")).toBeVisible();
    await expect(page.getByText("₹600.00")).toBeVisible();
    await expect(page.getByText("No signature yet", { exact: false })).toBeVisible();
    // Only a picture can be a signature (checked before anything is sent).
    await page.locator("#signature-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.getByText("Please choose a picture (PNG, WebP or JPEG) under 300 KB.")).toBeVisible();

    await choose(page, page.getByLabel("Day", { exact: true }), "Monday");
    await pickTime(page, page.getByLabel("From").first(), "10:00");
    await pickTime(page, page.getByLabel("To").first(), "13:00");
    await page.getByRole("button", { name: "Add hours" }).click();
    await expect(page.getByRole("cell", { name: "Monday" })).toBeVisible();

    await pickTime(page, page.getByLabel("From").first(), "12:00");
    await pickTime(page, page.getByLabel("To").first(), "14:00");
    await page.getByRole("button", { name: "Add hours" }).click();
    await expect(page.getByText("This overlaps with an existing entry")).toBeVisible();

    // The doctors list links to the same page.
    await page.getByRole("link", { name: "Back to doctors" }).click();
    await page.getByLabel("Search Doctors").fill(name);
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText("₹600.00");
    await row.getByRole("link", { name: "Hours, leave and signature" }).click();
    await expect(page.getByRole("cell", { name: "Monday" })).toBeVisible();
  });

  test("the admin page is grouped and opens the how-to guide", async ({ page }) => {
    await open(page, "/admin");
    for (const group of ["Clinic and staff", "Doctors and services", "Billing and documents", "Sales and marketing", "Data and safety"]) {
      await expect(page.getByRole("heading", { level: 2, name: group })).toBeVisible();
    }
    await page.getByRole("link", { name: /How to set up and use/ }).click();
    await expect(page).toHaveURL(/\/admin\/guide$/);
    for (const section of ["Add a doctor", "Add a service and its price", "The four billing sections", "What the four money boxes mean"]) {
      await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
    }
    await page.getByRole("link", { name: "Open Doctors" }).click();
    await expect(page).toHaveURL(/\/admin\/libraries\/doctors$/);
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
    await choose(page, page.getByLabel("What"), "Services");
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
