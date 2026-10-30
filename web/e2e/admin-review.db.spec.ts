import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { open, rpcAs, STATE } from "./helpers";

// W-ADM-33…35: items the desk added on the fly are reviewed by the admin; discharge templates
// are checked before saving (TEST_CASES.md).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.admin });

test("W-ADM-33/34 review: an item added on the fly can be kept; a near-duplicate merged into it (a choice is needed)", async ({ page }) => {
  const stamp = Date.now();
  const keepName = `E2E Review Keep ${stamp}`;
  const dupName = `E2E Review Dup ${stamp}`;
  await open(page, "/admin/review");
  for (const label of [keepName, dupName]) {
    await rpcAs(page, "library_create", { p_kind: "service", p_payload: { label, price_paise: 50_000 }, p_client_id: randomUUID() });
  }
  await page.reload();

  const dupRow = page.getByRole("row").filter({ hasText: dupName });
  await expect(dupRow).toBeVisible({ timeout: 15_000 });
  await dupRow.getByRole("button", { name: "Merge…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(dialog.getByText("Please fill this in.").or(dialog.locator('[aria-invalid="true"]')).first()).toBeVisible();
  await dialog.getByRole("combobox").first().click();
  await page.getByPlaceholder("Type to search…").fill(keepName);
  await page.getByRole("option", { name: new RegExp(`^${keepName}`) }).first().click();
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByText(/^Merged ✓/).first()).toBeVisible();
  await expect(dupRow).toHaveCount(0);

  const keepRow = page.getByRole("row").filter({ hasText: keepName });
  await keepRow.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByText("Kept ✓").first()).toBeVisible();
  await expect(keepRow).toHaveCount(0);
  // Nothing comes back after a reload.
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: `E2E Review Keep ${stamp}` })).toHaveCount(0);
});

test("W-ADM-35 discharge template: an empty name and a follow-up outside 0–3650 days are refused, nothing saved", async ({ page }) => {
  await open(page, "/admin/discharge-templates");
  const edit = page.getByRole("link", { name: /^Edit / }).first();
  await expect(page.getByText(/^(Loading…)$/)).toHaveCount(0, { timeout: 20_000 });
  test.skip((await edit.count()) === 0, "no discharge template on this database (made with “Save as template” on a summary)");
  await edit.click();
  const name = page.getByLabel("Name", { exact: true });
  const before = await name.inputValue();
  await name.fill("   ");
  await page.getByLabel("Follow-up (days)").fill("5000");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Follow-up (days)")).toHaveAttribute("aria-invalid", "true");
  await expect(name).toBeFocused();
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(before);
});
