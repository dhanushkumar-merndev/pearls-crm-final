import { expect, test } from "@playwright/test";
import { open, STATE, uniquePhone, newBill } from "./helpers";

// Phase 5: a receipt from blank to printed. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

test("receipt: new service on the fly, split payment, original then duplicate print", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Bill ${stamp}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  await page.getByRole("tab", { name: "Bills", exact: true }).click();
  await newBill(page, "New surgery bill");
  await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Surgery bill");

  // Line 1: a service that isn't in the library yet, added from the bill.
  const service = `E2E Service ${stamp}`;
  await page.getByRole("combobox", { name: "Service or item" }).first().click();
  await page.getByPlaceholder("Type to search…").fill(service);
  await page.getByRole("option", { name: `Add “${service}”` }).click();
  await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue(service);
  await page.getByLabel("Rate", { exact: true }).first().fill("1000");

  // Line 2: a library service with its own price.
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByRole("combobox", { name: "Service or item" }).nth(1).click();
  await page.getByPlaceholder("Type to search…").fill("Consultation");
  await page.getByRole("option", { name: /^Consultation/ }).first().click();
  await expect(page.getByLabel("Description", { exact: true }).nth(1)).toHaveValue("Consultation");
  await page.getByLabel("Rate", { exact: true }).nth(1).fill("500");

  // Preview before finalizing: saved, then shown as it prints (owner, 20/11/2026).
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const peek = page.getByRole("dialog");
  await expect(peek.getByRole("heading", { name: "Bill preview" })).toBeVisible();
  await expect(peek.frameLocator('[data-testid="print-preview"]').getByText(service).first()).toBeVisible();
  await peek.getByRole("button", { name: "Keep editing" }).click();
  await expect(peek).toHaveCount(0);

  await page.getByRole("button", { name: "Finalize bill" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Bill total ₹1,500.00", { exact: false })).toBeVisible();

  // Split: ₹1,000 cash + ₹500 UPI.
  await dialog.getByRole("combobox", { name: "Mode" }).first().click();
  await page.getByRole("option", { name: "Cash", exact: true }).click();
  await dialog.getByLabel("Amount", { exact: true }).first().fill("1000");
  await dialog.getByRole("button", { name: "Add another mode" }).click();
  await dialog.getByRole("combobox", { name: "Mode" }).nth(1).click();
  await page.getByRole("option", { name: "UPI", exact: true }).click();
  await dialog.getByLabel("Amount", { exact: true }).nth(1).fill("500");
  await dialog.getByRole("button", { name: "Fully paid" }).click();

  await expect(page.getByText(/^Bill .+ finalized$/)).toBeVisible();
  await expect(page.getByText("Finalized", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("·");

  const href = await page.getByRole("link", { name: "Print" }).getAttribute("href");
  expect(href).toMatch(/^\/print\/bill\//);

  // A peek from the patient's bill list is not a printed copy: the first print is still the Original.
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).first().click();
  await expect(page.getByRole("dialog").frameLocator('[data-testid="print-preview"]').getByText("Original", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Open" })).toHaveAttribute("href", /^\/bills\//);
  await page.keyboard.press("Escape");

  await page.goto(href!);
  await expect(page.getByText("Original", { exact: true })).toBeVisible();
  await expect(page.getByText(service).first()).toBeVisible();
  await page.goto(href!);
  await expect(page.getByText("Duplicate", { exact: true })).toBeVisible();
});
