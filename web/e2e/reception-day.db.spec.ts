import { expect, test, type Page } from "@playwright/test";
import { choose, open, STATE, uniquePhone } from "./helpers";

// W-REC-10…22: the front desk's lists and money edges (TEST_CASES.md).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

async function newPatient(page: Page, name: string, phone = uniquePhone()) {
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

async function pickMode(page: Page, mode: string) {
  await page.getByRole("dialog").getByRole("combobox", { name: "Mode" }).first().click();
  await page.getByRole("option", { name: mode, exact: true }).click();
}

test("appointments table: impossible and too-long ranges are refused; Excel downloads", async ({ page }) => {
  await open(page, "/appointments");
  await page.getByRole("tab", { name: "Table" }).click();
  await page.getByLabel("From").fill("2026-06-10");
  await page.getByLabel("To").fill("2026-06-01");
  await expect(page.getByText("The end must be after the start.").first()).toBeVisible();
  await page.getByLabel("From").fill("2024-01-01");
  await page.getByLabel("To").fill("2026-06-01");
  await expect(page.getByText(/at most one year/).first()).toBeVisible();

  await page.getByLabel("From").fill("2026-01-01");
  await page.getByLabel("To").fill("2026-12-31");
  await choose(page, page.getByLabel("Sort by"), "Doctor");
  const excel = page.getByRole("button", { name: "Download Excel" });
  test.skip(await excel.isDisabled(), "no appointments in 2026 on this database");
  const download = page.waitForEvent("download");
  await excel.click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
});

test("bills table: date checks, a status filter, and Excel", async ({ page }) => {
  await open(page, "/bills");
  await page.getByLabel("From").fill("2026-06-10");
  await page.getByLabel("To").fill("2026-06-01");
  await expect(page.getByText("The end must be after the start.").first()).toBeVisible();
  await page.getByLabel("From").fill("2026-01-01");
  await page.getByLabel("To").fill("2026-12-31");
  await choose(page, page.getByLabel("Status"), "Draft");
  // Every row listed is a draft.
  await expect(page.getByText(/Loading…/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("row").filter({ has: page.getByRole("link") }).filter({ hasNotText: "Draft" })).toHaveCount(0);
  await choose(page, page.getByLabel("Status"), "All");
  const excel = page.getByRole("button", { name: "Download Excel" });
  test.skip(await excel.isDisabled(), "no bills in 2026 on this database");
  const download = page.waitForEvent("download");
  await excel.click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
});

test("patients: search by phone finds the new patient; nonsense finds nobody", async ({ page }) => {
  const name = `E2E Search ${Date.now()}`;
  const phone = uniquePhone();
  await newPatient(page, name, phone);
  await open(page, "/patients");
  await page.getByLabel("Search name, phone or UHID").fill(phone.slice(-6));
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Search name, phone or UHID").fill("zzqx no such person");
  await expect(page.getByText("No patient found. Check the spelling or try the phone number.")).toBeVisible();
});

test("follow-ups: a task needs what to do; added, then done with an outcome", async ({ page }) => {
  const name = `E2E Followup ${Date.now()}`;
  await newPatient(page, name);
  await open(page, "/followups");
  await page.getByRole("button", { name: "Add follow-up" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Patient" }).click();
  await page.getByPlaceholder("Name, phone or UHID…").fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await dialog.getByRole("button", { name: /Add|Save/ }).last().click();
  await expect(dialog.getByLabel("What to do")).toHaveAttribute("aria-invalid", "true");
  await dialog.getByLabel("What to do").fill("E2E call to check healing");
  await dialog.getByRole("button", { name: /Add|Save/ }).last().click();
  await expect(page.getByText("Follow-up added ✓").first()).toBeVisible();

  // Due today or later: find it in Today / Upcoming.
  for (const tab of ["Today", "Upcoming"]) {
    await page.getByRole("tab", { name: tab }).click();
    if (await page.getByRole("row").filter({ hasText: name }).count()) break;
  }
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Done" }).click();
  await dialog.getByLabel("Outcome").fill("E2E spoke, healing well");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Done ✓").first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
});

test("advance and refund: kept for later bills; a refund can't be more than the advance", async ({ page }) => {
  await newPatient(page, `E2E Advance ${Date.now()}`);
  await page.getByRole("tab", { name: "Bills" }).click();
  await page.getByRole("button", { name: "Advance / refund" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save advance" }).click();
  await expect(dialog.getByLabel("Amount")).toHaveAttribute("aria-invalid", "true");
  await pickMode(page, "Cash");
  await dialog.getByLabel("Amount").fill("2000");
  await dialog.getByRole("button", { name: "Save advance" }).click();
  await expect(page.getByText("Advance of ₹2,000.00 saved").first()).toBeVisible();
  await expect(page.getByText("₹2,000.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Advance / refund" }).click();
  await choose(page, dialog.getByLabel("Type"), "Refund from advance");
  await pickMode(page, "Cash");
  await dialog.getByLabel("Amount").fill("3000");
  await dialog.getByRole("button", { name: "Save refund" }).click();
  await expect(page.getByText("That is more than what is due (or more than the advance available).").first()).toBeVisible();
  await dialog.getByLabel("Amount").fill("500");
  await dialog.getByRole("button", { name: "Save refund" }).click();
  await expect(page.getByText("Refund of ₹500.00 saved").first()).toBeVisible();
  await expect(page.getByText("₹1,500.00").first()).toBeVisible();
});

test("a receptionist's discount above the limit is refused; within it the bill is finalized", async ({ page }) => {
  const stamp = Date.now();
  await newPatient(page, `E2E Discount ${stamp}`);
  await page.getByRole("tab", { name: "Bills" }).click();
  await page.getByRole("button", { name: "New bill" }).click();
  await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Discounts above your limit need an admin.")).toBeVisible();

  const service = `E2E Discount Service ${stamp}`;
  await page.getByRole("combobox", { name: "Service or item" }).first().click();
  await page.getByPlaceholder("Type to search…").fill(service);
  await page.getByRole("option", { name: `Add “${service}”` }).click();
  // The picker fills the line when the server answers: type the rate after that.
  await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue(service);
  await page.getByLabel("Rate", { exact: true }).first().fill("1000");
  // 95% off: more than any receptionist limit.
  await page.getByLabel("Discount", { exact: true }).first().fill("950");
  // Finalizing saves first: the server refuses before the payment step opens.
  await page.getByRole("button", { name: "Finalize bill" }).click();
  await expect(page.getByText("That discount is more than you are allowed to give. Please ask the admin.").first()).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(0);

  await page.getByLabel("Discount", { exact: true }).first().fill("0");
  await page.getByRole("button", { name: "Finalize bill" }).click();
  // The payment step starts with the whole amount due.
  await pickMode(page, "Cash");
  await dialog.getByRole("button", { name: "Fully paid" }).click();
  await expect(page.getByText(/^Bill .+ finalized$/)).toBeVisible();
  // Finalized bills are locked for reception: no editing boxes, no amend.
  await expect(page.getByLabel("Rate", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More" })).toHaveCount(0);
});

test("sessions to book and admissions lists open with their filters", async ({ page }) => {
  await open(page, "/sessions");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/^(Loading…)$/)).toHaveCount(0, { timeout: 20_000 });
  await open(page, "/admissions");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/^(Loading…)$/)).toHaveCount(0, { timeout: 20_000 });
});
