import { expect, test } from "@playwright/test";
import { istDateString } from "@pearl/shared";
import { pickDate, STATE, uniquePhone } from "./helpers";

// Phase 19c: the sales sheet on the web (16/11/2026 training). A sales executive works in it: own
// leads only, cells save in place, a logged call fills Follow-up 1. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.sales });

test("sales executive: new lead, remarks, surgery date, quotation, call → follow-up 1, Excel", async ({
  page,
}) => {
  const stamp = Date.now();
  const name = `E2E Sheet ${stamp}`;
  const phone = uniquePhone();

  await page.goto("/leads/sheet?new=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New lead" })).toBeVisible();
  // An executive's new lead is their own: there is no owner picker.
  await expect(dialog.getByLabel("Owner")).toHaveCount(0);
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Mobile", { exact: true }).fill(phone);
  await dialog.getByRole("button", { name: "Save lead" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  // The lead page has no Delete for an executive, and Back goes to the sheet.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Back to sales sheet" }).click();
  await expect(page).toHaveURL(/\/leads\/sheet$/);

  await page.getByLabel("Search", { exact: true }).fill(phone.slice(-7));
  const grid = page.getByTestId("leads-sheet");
  const row = grid.locator("tr", { hasText: name });
  await expect(row).toHaveCount(1);
  await expect(page.getByText("1 lead", { exact: false }).first()).toBeVisible();
  // Every column of the handwritten sheet, in order.
  await expect(grid.locator("thead th")).toHaveText([
    "Sl No",
    "Patient name",
    "Source",
    "Phone",
    "Sales team",
    "Doctor",
    "Consultation date & time",
    "Prescription (quotation)",
    "Surgery date",
    "Follow-up 1",
    "Follow-up 2",
    "Follow-up 3",
    "Remarks",
  ]);
  // No owner dropdown for an executive; no booking yet, so the consultation cell offers Book.
  await expect(grid.getByRole("combobox", { name: /^Owner of/ })).toHaveCount(0);
  await expect(row.getByRole("button", { name: `Book a consultation for ${name}` })).toBeVisible();

  // Remarks: click, type, Enter saves.
  await row.getByRole("button", { name: `Remarks for ${name}` }).click();
  await row.getByRole("textbox", { name: `Remarks for ${name}` }).fill("Wants EMI options");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Saved ✓").first()).toBeVisible();
  await expect(row.getByRole("button", { name: `Remarks for ${name}` })).toContainText("Wants EMI options");

  // Surgery date: a day picked in the cell saves and moves the stage on.
  const surgery = istDateString(new Date(Date.now() + 10 * 86_400_000));
  await pickDate(page, row.getByRole("combobox", { name: `Surgery date for ${name}` }), surgery);
  await expect(row.getByText("Surgery fixed")).toBeVisible();

  // Quotation (the sheet's "Prescription"): quoted, then final.
  await row.getByRole("button", { name: `Quotation for ${name}` }).click();
  const quote = page.getByRole("dialog");
  await quote.getByLabel("Amount quoted").fill("60000");
  await quote.getByLabel("Amount finalised (agreed)").fill("55000");
  await quote.getByRole("button", { name: "Save amount" }).click();
  await expect(quote).toBeHidden();
  await expect(row.getByText("Quoted ₹60,000.00")).toBeVisible();
  await expect(row.getByText("Final ₹55,000.00")).toBeVisible();

  // A logged call fills Follow-up 1; the next empty cell offers the next call.
  await row.getByRole("button", { name: `Log a call for ${name}` }).click();
  const call = page.getByRole("dialog");
  await call.getByLabel("Length (minutes)").fill("3");
  await call.getByRole("button", { name: "Save call" }).click();
  await expect(page.getByText("Call saved ✓")).toBeVisible();
  await expect(row.locator('[data-col="f1"]')).toContainText("Spoke");
  await expect(
    row.locator('[data-col="f2"]').getByRole("button", { name: `Log a call for ${name}` }),
  ).toBeVisible();

  // Download Excel in the sheet's columns.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel" }).click();
  expect((await download).suggestedFilename()).toMatch(/^sales-sheet-.+\.xlsx$/);
});

test("sales executive: the sheet fits a phone without the page scrolling sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/leads/sheet");
  await expect(page.getByRole("heading", { level: 1, name: "Sales sheet" })).toBeVisible();
  await expect(page.getByTestId("leads-sheet")).toBeVisible();
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.scrollingElement!.scrollWidth,
    client: document.scrollingElement!.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client + 1);
});

test.describe("sales manager", () => {
  test.use({ storageState: STATE.manager });
  test("switches between the list and the sheet and can give a lead to the team", async ({
    page,
  }) => {
    await page.goto("/leads");
    await page.getByRole("link", { name: "Sheet", exact: true }).click();
    await expect(page).toHaveURL(/\/leads\/sheet$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sales sheet" })).toBeVisible();
    await expect(page.getByLabel("Sales team", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/\/leads$/);
  });
});
