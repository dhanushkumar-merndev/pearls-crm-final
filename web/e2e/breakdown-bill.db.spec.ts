import { expect, test } from "@playwright/test";
import { newBill, open, STATE, uniquePhone } from "./helpers";

// Phase 19a: the four billing sections and the breakdown bill for insurance. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

test("breakdown bill: from a surgery bill, split a line, finalize, print; dues unchanged", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Breakdown ${stamp}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  // A ₹1,000 surgery bill, nothing paid.
  await page.getByRole("tab", { name: "Bills", exact: true }).click();
  await newBill(page, "New surgery bill");
  await page.getByRole("combobox", { name: "Service or item" }).first().click();
  await page.getByPlaceholder("Type to search…").fill("Consultation");
  await page.getByRole("option", { name: /^Consultation/ }).first().click();
  await page.getByLabel("Rate", { exact: true }).first().fill("1000");
  await page.getByRole("button", { name: "Finalize bill" }).click();
  const fin = page.getByRole("dialog");
  await fin.getByLabel("Amount", { exact: true }).first().fill("");
  await fin.getByRole("button", { name: /^Nothing paid now/ }).click();
  await expect(page.getByText(/^Bill .+ finalized$/)).toBeVisible();
  const billUrl = page.url();

  // On the bill itself: "Breakdown bill" → this bill is ticked → the editor opens filled from it.
  await page.getByRole("button", { name: "Breakdown bill" }).click();
  const make = page.getByRole("dialog");
  await expect(make.getByTestId("bb-bills").getByRole("checkbox")).toBeChecked();
  await make.getByRole("button", { name: "Make breakdown bill" }).click();
  await expect(page).toHaveURL(/\/breakdown\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Breakdown bill");
  await expect(page.getByTestId("bb-line")).toHaveCount(1);
  await expect(page.getByLabel("Particulars").first()).toHaveValue("Consultation");

  // Split the line: two halves, the second waits for a name (finalize refuses it empty).
  await page.getByRole("button", { name: "Split line 1 into two" }).click();
  await expect(page.getByTestId("bb-line")).toHaveCount(2);
  await expect(page.getByTestId("bb-total")).toHaveText("₹1,000.00");
  await page.getByRole("button", { name: "Finalize" }).click();
  await expect(page.getByLabel("Particulars").nth(1)).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Particulars").nth(1).fill("OT charges");
  // Free total: the second half goes up; the billed amount is only a reference.
  await page.getByLabel("Amount", { exact: true }).nth(1).fill("700");
  await expect(page.getByTestId("bb-total")).toHaveText("₹1,200.00");
  await expect(page.getByTestId("bb-totals")).toContainText("Differs by ₹200.00");
  await page.getByLabel("Insurance company").fill("E2E Insurance Co");

  await page.getByRole("button", { name: "Finalize" }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: "Finalize" }).click();
  await expect(page.getByText(/^Finalized: /)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/·\s*\S/);

  const href = await page.getByRole("link", { name: "Print" }).getAttribute("href");
  expect(href).toMatch(/^\/print\/breakdown\//);
  await page.goto(href!);
  await expect(page.getByText("Original", { exact: true })).toBeVisible();
  await expect(page.getByText("OT charges")).toBeVisible();
  await expect(page.getByText("E2E Insurance Co")).toBeVisible();
  // The clinic's "Final bill" terms print on it too (owner, 20/11/2026).
  await expect(page.getByRole("heading", { name: "Terms & Conditions" })).toBeVisible();

  // The bill now links to its breakdown; what the patient owes is unchanged (₹1,000).
  await page.goto(billUrl);
  await expect(page.getByRole("link", { name: /^Breakdown bill \S/ })).toBeVisible();
  await expect(page.getByTestId("bill-balance")).toHaveText("₹1,000.00");

  // Patient → Bills: four sections; the breakdown is listed in its own.
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await page.getByRole("tab", { name: "Bills", exact: true }).click();
  for (const s of ["Surgery bills", "Pharmacy bills", "Breakdown bills (insurance)", "Discharge summaries"]) {
    await expect(page.getByRole("tab", { name: s })).toBeVisible();
  }
  await page.getByRole("tab", { name: "Breakdown bills (insurance)" }).click();
  await expect(page).toHaveURL(/section=breakdown/);
  await expect(page.getByTestId("breakdown-table").getByRole("row").filter({ hasText: "E2E Insurance Co" })).toContainText("₹1,200.00");
  await page.getByRole("tab", { name: "Discharge summaries" }).click();
  await expect(page.getByTestId("discharge-table")).toContainText("No discharge summaries yet.");
});

test("/bills: the four sections, each its own list", async ({ page }) => {
  await open(page, "/bills");
  await page.getByRole("tab", { name: "Breakdown bills (insurance)" }).click();
  await expect(page.getByTestId("breakdown-table")).toBeVisible();
  await page.getByRole("tab", { name: "Pharmacy bills" }).click();
  // Only pharmacy bills here: no type filter.
  await expect(page.getByLabel("Type", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Surgery bills" }).click();
  await expect(page.getByLabel("Type", { exact: true })).toBeVisible();
});
