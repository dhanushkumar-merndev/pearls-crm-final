import { expect, test } from "@playwright/test";
import { open, rpcAs, STATE } from "./helpers";

// Phase 13: the admin's BDM pages. The phone side (start, visits, chunks, watchdog, estimates)
// is covered by supabase/tests/database/19_bdm.test.sql. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("offices: the form explains bad coordinates; a good office is listed", async ({ page }) => {
    const name = `E2E Office ${Date.now()}`;
    await open(page, "/admin");
    await page.getByRole("link", { name: /Offices/ }).click();
    await page.getByRole("button", { name: "Add office" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Please fill this in.").first()).toBeVisible();
    await expect(dialog.getByLabel("Office name")).toBeFocused();

    await dialog.getByLabel("Office name").fill(name);
    await dialog.getByLabel("Latitude").fill("123.4");
    await dialog.getByLabel("Longitude").fill("77.594612");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByLabel("Latitude")).toHaveAttribute("aria-invalid", "true");

    await dialog.getByLabel("Latitude").fill("12.971601");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved ✓")).toBeVisible();
    await page.getByLabel("Search Offices").fill(name);
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText("12.971601, 77.594612");
    await expect(row).toContainText("200 m");
  });

  test("BDM page: live list, a day sheet, and the Excel report", async ({ page }) => {
    await open(page, "/home");
    await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "BDM" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "BDM field work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Map of BDMs" })).toBeVisible();

    const people = await rpcAs<{ staff_id: string; name: string }[]>(page, "bdm_live", {});
    const list = page.getByRole("region", { name: "BDMs" });
    if (people.length === 0) {
      await expect(list.getByText("No active BDM logins.")).toBeVisible();
    } else {
      const first = people[0]!;
      await expect(list.getByText(first.name).first()).toBeVisible();
      // A date long before go-live: nothing was recorded.
      await page.goto(`/bdm/${first.staff_id}?date=2026-01-05`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(first.name);
      await expect(page.getByText("No day was started on this date.")).toBeVisible();
      await page.getByRole("button", { name: "Next day" }).click();
      await expect(page).toHaveURL(/date=2026-01-06/);
      await page.goBack();
      await page.goto("/bdm");
    }

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Excel" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^bdm-report-\d{4}-\d{2}-01-to-\d{4}-\d{2}-\d{2}\.xlsx$/);
    await expect(page.getByText(/downloaded\./)).toBeVisible();

    // An impossible range is refused before anything is asked.
    await page.getByLabel("From", { exact: true }).fill("2026-05-10");
    await page.getByLabel("To", { exact: true }).fill("2026-05-01");
    await expect(page.getByRole("button", { name: "Download Excel" })).toBeDisabled();
  });
});
