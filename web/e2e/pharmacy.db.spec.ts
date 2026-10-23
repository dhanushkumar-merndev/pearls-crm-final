import { expect, test } from "@playwright/test";
import { open, STATE, uniquePhone } from "./helpers";

// Phase 6: buy in → sell from the FEFO batch → stock and ledger follow. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

test("purchase a new medicine, sell 3 on a pharmacy bill, write off 1", async ({ page }) => {
  const stamp = Date.now();
  const medicine = `E2E Tablet ${stamp}`;

  // 1. A supplier invoice with a medicine and a supplier added on the fly.
  await open(page, "/pharmacy/purchases/new");
  await page.getByRole("combobox", { name: "Supplier" }).click();
  await page.getByPlaceholder("Type to search…").fill(`E2E Supplier ${stamp}`);
  await page.getByRole("option", { name: `Add “E2E Supplier ${stamp}”` }).click();
  await page.getByLabel("Supplier invoice no.").fill(`E2E-${stamp}`);
  await page.getByRole("combobox", { name: "Medicine" }).click();
  await page.getByPlaceholder("Type to search…").fill(medicine);
  await page.getByRole("option", { name: `Add “${medicine}”` }).click();
  await page.getByLabel("Batch", { exact: true }).fill("E2EB1");
  await page.getByLabel("Expiry", { exact: true }).fill("2030-12");
  await page.getByLabel("Qty", { exact: true }).fill("10");
  await page.getByLabel("Purchase price", { exact: true }).fill("5");
  await page.getByLabel("MRP", { exact: true }).fill("10");
  await expect(page.getByText("Invoice total ₹50.00")).toBeVisible();
  await page.getByRole("button", { name: "Post to stock" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Post to stock" }).click();
  await expect(page.getByText(`Purchase E2E-${stamp} posted to stock ✓`)).toBeVisible();
  await expect(page.getByText("Posted", { exact: true })).toBeVisible();

  // 2. A patient buys 3: the batch is picked for them (earliest expiry first).
  await open(page, "/patients/new");
  const name = `E2E Pharm ${stamp}`;
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.getByRole("tab", { name: "Bills" }).click();
  await page.getByRole("button", { name: "New pharmacy bill" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pharmacy invoice");
  await page.getByRole("combobox", { name: "Medicine" }).click();
  await page.getByPlaceholder("Type to search…").fill(medicine);
  await page.getByRole("option", { name: new RegExp(medicine) }).first().click();
  await expect(page.getByLabel("Batch", { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByLabel("Batch", { exact: true }).locator("option:checked")).toHaveText(/E2EB1 · exp 12\/2030 · 10 left/);
  await page.getByLabel("Qty", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Finalize bill" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Bill total ₹30.00", { exact: false })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Mode" }).click();
  await page.getByRole("option", { name: "Cash", exact: true }).click();
  await dialog.getByRole("button", { name: "Fully paid" }).click();
  await expect(page.getByText(/^Bill .+ finalized$/)).toBeVisible();

  // 3. Stock follows: 10 − 3 = 7; a damaged strip takes it to 6. The history shows each step.
  await open(page, "/pharmacy");
  await page.getByLabel("Search medicines").fill(medicine);
  await page.getByRole("link", { name: medicine }).click();
  await expect(page.getByText("7 unit in stock", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Adjust batch E2EB1" }).click();
  const adjust = page.getByRole("dialog");
  await adjust.getByLabel("What happened").selectOption("damaged");
  await adjust.getByLabel("How many").fill("1");
  await adjust.getByLabel("Reason").fill("strip torn");
  await adjust.getByRole("button", { name: "Save adjustment" }).click();
  await expect(page.getByText("Stock adjusted ✓")).toBeVisible();
  await expect(page.getByText("6 unit in stock", { exact: false })).toBeVisible();
  for (const step of ["Purchase", "Sold", "Damaged"]) await expect(page.getByRole("cell", { name: new RegExp(`^${step}`) }).first()).toBeVisible();
});
