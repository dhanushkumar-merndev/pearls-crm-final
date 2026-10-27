import { expect, test, type Page } from "@playwright/test";
import { open, STATE, uniquePhone } from "./helpers";

// W-ADM-30…34, W-REC-30…32: bills after finalizing, and pharmacy batches (TEST_CASES.md).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

async function newPatient(page: Page, name: string) {
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

async function pickMode(page: Page, mode: string, nth = 0) {
  await page.getByRole("dialog").getByRole("combobox", { name: "Mode" }).nth(nth).click();
  await page.getByRole("option", { name: mode, exact: true }).click();
}

/** Posts a supplier invoice with one batch of [medicine]. */
async function purchase(page: Page, medicine: string, batch: string, expiry: string, isNew: boolean, confirm = true) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await open(page, "/pharmacy/purchases/new");
  await page.getByRole("combobox", { name: "Supplier" }).click();
  await page.getByPlaceholder("Type to search…").fill(`E2E Supplier ${stamp}`);
  await page.getByRole("option", { name: `Add “E2E Supplier ${stamp}”` }).click();
  await expect(page.getByRole("combobox", { name: "Supplier" })).toHaveText(`E2E Supplier ${stamp}`);
  await page.getByLabel("Supplier invoice no.").fill(`E2E-${stamp}`);
  await page.getByRole("combobox", { name: "Medicine" }).click();
  await page.getByPlaceholder("Type to search…").fill(medicine);
  if (isNew) await page.getByRole("option", { name: `Add “${medicine}”` }).click();
  else await page.getByRole("option", { name: new RegExp(medicine) }).first().click();
  await expect(page.getByRole("combobox", { name: "Medicine" })).toHaveText(medicine);
  await page.getByLabel("Batch", { exact: true }).fill(batch);
  await page.getByLabel("Expiry", { exact: true }).fill(expiry);
  await page.getByLabel("Qty", { exact: true }).fill("10");
  await page.getByLabel("Purchase price", { exact: true }).fill("5");
  await page.getByLabel("MRP", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Post to stock" }).click();
  // A line the screen refuses (e.g. an expired batch) never reaches the confirm step.
  if (confirm) await page.getByRole("dialog").getByRole("button", { name: "Post to stock" }).click();
}

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("a finalized bill: amend keeps its number (a reason is needed); cancel stops payments", async ({ page }) => {
    test.setTimeout(90_000);
    await newPatient(page, `E2E Amend ${Date.now()}`);
    await page.getByRole("tab", { name: "Bills" }).click();
    await page.getByRole("button", { name: "New bill" }).click();
    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    await page.getByRole("combobox", { name: "Service or item" }).first().click();
    await page.getByPlaceholder("Type to search…").fill("Consultation");
    await page.getByRole("option", { name: /^Consultation/ }).first().click();
    await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue("Consultation");
    await page.getByLabel("Rate", { exact: true }).first().fill("1000");
    await page.getByRole("button", { name: "Finalize bill" }).click();
    const dialog = page.getByRole("dialog");
    // Nothing paid now: the whole amount stays due.
    await dialog.getByLabel("Amount", { exact: true }).first().fill("");
    await dialog.getByRole("button", { name: /^Nothing paid now/ }).click();
    await expect(page.getByText(/^Bill .+ finalized$/)).toBeVisible();
    // The number appears in the heading once the finalized bill has reloaded.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/·\s*\S/);
    const heading = (await page.getByRole("heading", { level: 1 }).innerText()).trim();

    // Amend and Cancel are admin-only extras under "More".
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Amend" }).click();
    await page.getByLabel("Rate", { exact: true }).first().fill("1200");
    await page.getByRole("button", { name: "Save change" }).click();
    await expect(page.getByLabel("Reason for the change")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Reason for the change").fill("E2E price corrected");
    await page.getByRole("button", { name: "Save change" }).click();
    await expect(page.getByText("Bill changed — the old version is kept").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByText("₹1,200.00").first()).toBeVisible();

    // A part payment, then cancel: the bill can't take payments any more.
    await page.getByRole("button", { name: "Add payment" }).click();
    await pickMode(page, "Cash");
    await dialog.getByLabel("Amount", { exact: true }).fill("5000");
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expect(dialog.getByText(/More than what is due|more than what is due/).first()).toBeVisible();
    await dialog.getByLabel("Amount", { exact: true }).fill("200");
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText("Payment of ₹200.00 saved").first()).toBeVisible();

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Cancel bill" }).click();
    await dialog.getByRole("button", { name: "Cancel bill" }).click();
    await expect(dialog.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Reason").fill("E2E entered twice");
    await dialog.getByRole("button", { name: "Cancel bill" }).click();
    await expect(page.getByText("Bill cancelled").first()).toBeVisible();
    await expect(page.getByText("Cancelled: E2E entered twice")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add payment" })).toHaveCount(0);
    // Nothing left to amend or cancel: no "More" menu at all.
    await expect(page.getByRole("button", { name: "More" })).toHaveCount(0);
  });
});

test.describe("reception pharmacy", () => {
  test.use({ storageState: STATE.reception });

  test("an expired batch can't be bought in; the batch expiring first is sold first", async ({ page }) => {
    test.setTimeout(120_000);
    const medicine = `E2E Syrup ${Date.now()}`;
    await purchase(page, medicine, "E2EOLD", "2024-01", true, false);
    await expect(page.getByText("This batch has expired and can't be sold or bought in.").first()).toBeVisible();

    await purchase(page, medicine, "E2ELATE", "2031-06", true);
    await expect(page.getByText(/posted to stock ✓/)).toBeVisible();
    await purchase(page, medicine, "E2EEARLY", "2030-03", false);
    await expect(page.getByText(/posted to stock ✓/)).toBeVisible();

    await newPatient(page, `E2E FEFO ${Date.now()}`);
    await page.getByRole("tab", { name: "Bills" }).click();
    await page.getByRole("button", { name: "New pharmacy bill" }).click();
    await page.getByRole("combobox", { name: "Medicine" }).click();
    await page.getByPlaceholder("Type to search…").fill(medicine);
    await page.getByRole("option", { name: new RegExp(medicine) }).first().click();
    await expect(page.getByLabel("Batch", { exact: true })).toHaveText(/E2EEARLY · exp 03\/2030/);
    // More than the batch holds is stopped.
    await page.getByLabel("Qty", { exact: true }).fill("11");
    await page.getByRole("button", { name: "Finalize bill" }).click();
    // The stock is checked when the bill is finalized (after the payment step).
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount", { exact: true }).first().fill("");
    await dialog.getByRole("button", { name: /^Nothing paid now/ }).click();
    await expect(page.getByText(/Not enough stock in this batch/).first()).toBeVisible();
  });
});
