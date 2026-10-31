import { expect, test } from "@playwright/test";
import { choose, open, STATE, uniquePhone } from "./helpers";

// Phase 6: buy in → sell from the FEFO batch → stock and ledger follow. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });
// Five screens in one flow (purchase, patient, bill, stock, adjust): over 30 s when staging is busy.
test.setTimeout(90_000);

test("purchase a new medicine, sell 3 on a pharmacy bill, write off 1", async ({ page }) => {
  const stamp = Date.now();
  const medicine = `E2E Tablet ${stamp}`;

  // 1. A supplier invoice with a medicine and a supplier added on the fly.
  await open(page, "/pharmacy/purchases/new");
  await page.getByRole("combobox", { name: "Supplier" }).click();
  await page.getByPlaceholder("Type to search…").fill(`E2E Supplier ${stamp}`);
  await page.getByRole("option", { name: `Add “E2E Supplier ${stamp}”` }).click();
  await expect(page.getByRole("combobox", { name: "Supplier" })).toHaveText(`E2E Supplier ${stamp}`);
  await page.getByLabel("Supplier invoice no.").fill(`E2E-${stamp}`);
  await page.getByRole("combobox", { name: "Medicine" }).click();
  await page.getByPlaceholder("Type to search…").fill(medicine);
  await page.getByRole("option", { name: `Add “${medicine}”` }).click();
  await expect(page.getByRole("combobox", { name: "Medicine" })).toHaveText(medicine);
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
  // Makes the bill on the server, then opens its page.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pharmacy invoice", { timeout: 30_000 });
  // A slow server: the medicine's batches take 3 s. Qty and Finalize straight after the pick must
  // still work (the first click used to do nothing: the check ran on the half-filled line, 31/10/2026).
  await page.route(/\/rest\/v1\/rpc\/batches_for_sale/, async (r) => {
    await new Promise((done) => setTimeout(done, 3_000));
    await r.continue();
  });
  await page.getByRole("combobox", { name: "Medicine" }).click();
  await page.getByPlaceholder("Type to search…").fill(medicine);
  await page.getByRole("option", { name: new RegExp(medicine) }).first().click();
  await page.getByLabel("Qty", { exact: true }).fill("3");
  await expect(page.getByRole("button", { name: "Loading…" })).toBeDisabled();
  await page.getByRole("button", { name: "Finalize bill" }).click();
  // FEFO picked the batch by itself (the dropdown shows the chosen one).
  await expect(page.getByLabel("Batch", { exact: true })).toHaveText(/E2EB1 · exp 12\/2030 · 10 left/);
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
  await choose(page, adjust.getByLabel("What happened"), "Damaged");
  await adjust.getByLabel("How many").fill("1");
  await adjust.getByLabel("Reason").fill("strip torn");
  await adjust.getByRole("button", { name: "Save adjustment" }).click();
  await expect(page.getByText("Stock adjusted ✓")).toBeVisible();
  await expect(page.getByText("6 unit in stock", { exact: false })).toBeVisible();
  for (const step of ["Purchase", "Sold", "Damaged"]) await expect(page.getByRole("cell", { name: new RegExp(`^${step}`) }).first()).toBeVisible();
});
