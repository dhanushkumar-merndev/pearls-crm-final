import { expect, test } from "@playwright/test";
import { open, selectAs, STATE, uniquePhone } from "./helpers";

// W-PRN-01…08: the printed bill cum receipt (TEST_CASES.md). Everything on the letterhead and the
// terms comes from Admin → Clinic profile, so the test reads clinic_settings and compares.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception, colorScheme: "dark" });

interface ClinicRow {
  name: string;
  gstin: string | null;
  phones: string[];
  logo_path: string | null;
  terms: Record<string, string[]>;
}

test("bill cum receipt: letterhead and terms from the clinic profile, empty columns hidden, white paper, original then duplicate", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Print ${stamp}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  await page.getByRole("tab", { name: "Bills" }).click();
  await page.getByRole("button", { name: "New bill" }).click();
  await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
  const service = `E2E Print Service ${stamp}`;
  await page.getByRole("combobox", { name: "Service or item" }).first().click();
  await page.getByPlaceholder("Type to search…").fill(service);
  await page.getByRole("option", { name: `Add “${service}”` }).click();
  await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue(service);
  await page.getByLabel("Rate", { exact: true }).first().fill("1250.50");

  await page.getByRole("button", { name: "Finalize bill" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Mode" }).first().click();
  await page.getByRole("option", { name: "Cash", exact: true }).click();
  await dialog.getByRole("button", { name: "Fully paid" }).click();
  await expect(page.getByText(/^Bill .+ finalized$/)).toBeVisible();
  const href = await page.getByRole("link", { name: "Print", exact: true }).getAttribute("href");

  const [clinic] = await selectAs<ClinicRow>(page, "clinic_settings?branch_code=eq.main&select=name,gstin,phones,logo_path,terms");
  expect(clinic, "clinic_settings has a main branch").toBeTruthy();

  await page.goto(href!);
  // W-PRN-01 letterhead = clinic profile (nothing typed into the page)
  await expect(page.locator(".letterhead h1")).toHaveText(clinic!.name);
  if (clinic!.gstin) await expect(page.locator(".lh-ids")).toContainText(clinic!.gstin);
  if (clinic!.phones.length) await expect(page.locator(".lh-phones")).toContainText(clinic!.phones[0]!);
  // W-PRN-02 title, patient, Original on the first print
  await expect(page.locator(".doc-title")).toHaveText("Bill cum receipt");
  await expect(page.locator(".patient-name")).toHaveText(name);
  await expect(page.locator(".copy")).toHaveText("Original");
  // W-PRN-03 money: paise kept, paid in full, amount in words
  await expect(page.locator(".items")).toContainText(service);
  await expect(page.locator(".totals .grand")).toContainText("₹1,250.50");
  await expect(page.locator(".totals .due")).toContainText("Paid in full");
  await expect(page.locator(".words")).toContainText(/One Thousand Two Hundred Fifty/i);
  // W-PRN-04 no discount, no GST and no per-line date on this bill → those columns are left out
  const heads = page.locator(".items thead th");
  await expect(heads.filter({ hasText: /^Disc\.$/ })).toHaveCount(0);
  await expect(heads.filter({ hasText: /^GST$/ })).toHaveCount(0);
  await expect(heads.filter({ hasText: /^Date$/ })).toHaveCount(0);
  // W-PRN-05 numbered terms for this bill type, exactly as saved
  const terms = clinic!.terms?.procedure_receipt ?? [];
  if (terms.length) {
    await expect(page.locator("ol.terms li")).toHaveCount(terms.length);
    await expect(page.locator("ol.terms li").first()).toContainText(terms[0]!);
  } else {
    await expect(page.locator(".terms-box")).toHaveCount(0);
  }
  // W-PRN-06 logo watermark, fixed so it repeats on every printed page
  if (clinic!.logo_path) {
    const mark = page.locator(".watermark");
    await expect(mark.locator("img")).toHaveCount(1);
    expect(await mark.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  }
  // W-PRN-07 white paper even when the app is in the dark theme
  for (const sel of [".print-root", "body"]) {
    expect(await page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  }
  expect(await page.evaluate(() => getComputedStyle(document.body).colorScheme)).toContain("light");

  // W-PRN-08 any later print of the same bill says Duplicate
  await page.goto(href!);
  await expect(page.locator(".copy")).toHaveText("Duplicate");
});
