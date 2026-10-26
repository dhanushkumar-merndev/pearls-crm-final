import { expect, test } from "@playwright/test";
import { choose, open, rpcAs, STATE } from "./helpers";

// Phase 14: admin dashboard, notification rules, sales targets, Backup centre. The server rules
// (purge refuses unverified files, resume, re-check, reminders) are in
// supabase/tests/database/21_ops.test.sql; the folder engine in web/lib/backup.test.ts.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("dashboard: tiles, charts with a table view, storage and connections", async ({ page }) => {
    await open(page, "/home");
    await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Revenue", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("No-show rate")).toBeVisible();
    await expect(page.getByRole("meter", { name: "Database" })).toBeVisible();

    const chart = page.locator("[aria-labelledby]").filter({ has: page.getByRole("heading", { name: "Revenue and collections" }) });
    await chart.getByRole("button", { name: "View as table" }).click();
    await expect(chart.getByRole("table")).toBeVisible();

    await choose(page, page.getByLabel("Period"), "Today");
    await expect(chart.getByRole("row")).toHaveCount(2);
  });

  test("notification rules: a change is saved and kept", async ({ page }) => {
    await open(page, "/admin/notifications");
    const email = page.getByLabel("Email for: Pharmacy alerts");
    const before = await email.isChecked();
    await email.setChecked(!before);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved ✓")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Email for: Pharmacy alerts")).toBeChecked({ checked: !before });
    // Back as it was, for everyone else.
    await page.getByLabel("Email for: Pharmacy alerts").setChecked(before);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved ✓").first()).toBeVisible();
  });

  test("users: a contact email for summaries is checked, saved and can be cleared", async ({ page }) => {
    await open(page, "/admin/users");
    // Exactly the username cell (the role column also says "manager").
    const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "manager", exact: true }) });
    await row.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email (optional)").fill("not an email");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByLabel("Email (optional)")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("Email (optional)")).toBeFocused();

    await dialog.getByLabel("Email (optional)").fill("e2e-manager@example.com");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await page.reload();
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(dialog.getByLabel("Email (optional)")).toHaveValue("e2e-manager@example.com");
    await dialog.getByLabel("Email (optional)").fill("");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  });

  test("sales targets: a whole number is needed; a saved target shows progress", async ({ page }) => {
    const month = await rpcAs<{ people: { staff_id: string; name: string }[] }>(page, "sales_targets_month", { p_month: null });
    test.skip(month.people.length === 0, "no salespeople on this database");
    await open(page, "/targets");
    // The first person (the order is stable even when names repeat).
    const row = page.getByRole("row").nth(1);
    const box = row.getByLabel(/^Calls target for /);
    const save = row.getByRole("button", { name: /^Save the Calls target for / });
    await box.fill("12.5");
    await save.click();
    await expect(row.getByText("Use a whole number.")).toBeVisible();
    await expect(box).toBeFocused();

    await box.fill("400");
    await save.click();
    await expect(row.getByText(/of 400 \(\d+%\)/)).toBeVisible();
    // Cleared again: empty = no target.
    await box.fill("");
    await save.click();
    await expect(row.getByText(/of 400/)).toHaveCount(0);
  });

  test("backup centre: folder, database export, and a purge preview that keeps unbacked files", async ({ page }) => {
    test.setTimeout(180_000);
    // The browser's private storage stands in for the folder picker (a native dialog).
    await page.addInitScript(() => {
      (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = () =>
        navigator.storage.getDirectory();
    });
    await open(page, "/admin/backup");
    await expect(page.getByRole("heading", { level: 1, name: "Backup centre" })).toBeVisible();
    await expect(page.getByRole("meter", { name: "Database" })).toBeVisible();

    // The form explains a missing choice before anything is asked of the server.
    const kinds = page.getByRole("group", { name: "Kinds of files" }).first();
    for (const box of await kinds.getByRole("checkbox").all()) await box.uncheck();
    await page.getByRole("button", { name: "Start backup" }).click();
    await expect(page.getByText("Please choose one.").first()).toBeVisible();

    await page.getByRole("button", { name: "Choose folder" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saving into" })).toBeVisible();

    // Real files: downloaded from storage, written, read back and checked (or "0 files" when all are done).
    await kinds.getByRole("checkbox", { name: "Documents" }).check();
    await page.getByRole("button", { name: /^(Start backup|Carry on with the backup)$/ }).click();
    await expect(page.getByText(/files? copied and checked ✓|files copied; \d+ couldn't be copied/)).toBeVisible({ timeout: 120_000 });

    await page.getByRole("button", { name: "Export the database" }).click();
    await expect(page.getByText(/Database exported: \d+ tables ✓/)).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText(/Database last exported/)).toBeVisible();

    await page.getByRole("button", { name: "Show what can be removed" }).click();
    await expect(page.getByRole("columnheader", { name: "Not backed up (kept)" })).toBeVisible();
  });
});

test.describe("sales manager", () => {
  test.use({ storageState: STATE.manager });

  test("sees the targets page but cannot change targets", async ({ page }) => {
    await open(page, "/targets");
    await expect(page.getByRole("heading", { level: 1, name: "Sales targets" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save the / })).toHaveCount(0);
    await page.goto("/admin/backup");
    await expect(page.getByText("This page doesn't exist")).toBeVisible();
  });
});
