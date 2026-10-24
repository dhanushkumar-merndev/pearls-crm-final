import { expect, test, type Page } from "@playwright/test";
import { choose, open, STATE, uniquePhone } from "./helpers";

// Phase 9: leads for the sales manager, the reception hand-over, import. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

/** /leads?new=1 opens the dialog at once (a modal hides the menu, so wait for the dialog instead). */
async function openNewLead(page: Page) {
  await page.goto("/leads?new=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New lead" })).toBeVisible();
  return dialog;
}

async function newLead(page: Page, name: string, phone: string) {
  const dialog = await openNewLead(page);
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Mobile", { exact: true }).fill(phone);
  await dialog.getByRole("button", { name: "Save lead" }).click();
}

test.describe("sales manager", () => {
  test.use({ storageState: STATE.manager });

  test("the new-lead form explains what's missing before anything is sent", async ({ page }) => {
    const dialog = await openNewLead(page);
    await dialog.getByRole("button", { name: "Save lead" }).click();
    await expect(dialog.getByText("Please fill this in.")).toHaveCount(2);
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await dialog.getByLabel("Name").fill("x");
    await expect(dialog.getByText("Please fill this in.")).toHaveCount(1); // typing clears that field's message
    await dialog.getByLabel("Mobile", { exact: true }).fill("12345");
    await dialog.getByLabel("Email").fill("not-an-email");
    await dialog.getByRole("button", { name: "Save lead" }).click();
    await expect(dialog.getByText(/That number doesn't look right/)).toBeVisible();
    await expect(dialog.getByText(/That email doesn't look right/)).toBeVisible();
  });

  test("create → lead page; the same number again is caught; stage, call and note go into the history", async ({ page }) => {
    const phone = uniquePhone();
    const name = `E2E Lead ${Date.now()}`;
    await newLead(page, name, phone);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    const leadUrl = page.url();

    // Same number: asked first, then saved as a linked lead.
    await newLead(page, `${name} Again`, phone);
    const dup = page.getByRole("dialog");
    await expect(dup.getByRole("heading", { name: "This number already has a lead" })).toBeVisible();
    await dup.getByRole("button", { name: "Save as a new lead anyway" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name} Again`);
    await expect(page.getByText("Other leads with this number")).toBeVisible();

    await page.goto(leadUrl);
    // Lost needs a reason: the form says so.
    await page.getByRole("button", { name: "Change stage" }).click();
    const stage = page.getByRole("dialog");
    await choose(page, stage.getByLabel("Stage"), "Lost");
    await stage.getByRole("button", { name: "Save stage" }).click();
    await expect(stage.getByText("Choose why the lead was lost.")).toBeVisible();
    await choose(page, stage.getByLabel("Stage"), "Interested");
    await stage.getByRole("button", { name: "Save stage" }).click();
    await expect(page.getByText("Stage: Interested ✓")).toBeVisible();

    await page.getByRole("button", { name: "Log a call" }).click();
    const call = page.getByRole("dialog");
    await call.getByLabel("Length (minutes)").fill("4");
    await call.getByLabel("What was said").fill("Wants the price list");
    await call.getByRole("button", { name: "Save call" }).click();
    await expect(page.getByText("Call saved ✓")).toBeVisible();

    await page.getByLabel("Add a note").fill("Call again after Diwali");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Call again after Diwali")).toBeVisible();
    await expect(page.getByText("Wants the price list").first()).toBeVisible();
    await expect(page.getByText("Stage changed to Interested")).toBeVisible();
  });

  test("leads table: search finds the lead; an impossible date range is refused before loading", async ({ page }) => {
    const phone = uniquePhone();
    const name = `E2E Table ${Date.now()}`;
    await newLead(page, name, phone);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await open(page, "/leads");
    await page.getByLabel("Search", { exact: true }).fill(phone.slice(-6));
    await expect(page.getByRole("link", { name })).toBeVisible();
    await page.getByLabel("From").fill("2026-12-31");
    await page.getByLabel("To").fill("2026-01-01");
    await expect(page.getByText("The end must be after the start.")).toBeVisible();
  });

  test("import: template downloads; bad rows are listed in the browser and can be left out", async ({ page }) => {
    await open(page, "/leads/import");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download template (CSV)" }).click();
    expect((await download).suggestedFilename()).toBe("leads-template.csv");

    const good = uniquePhone();
    const csv = `Name,Mobile,Status\r\nE2E Import ${Date.now()},${good},New\r\n,12345,Maybe\r\n`;
    await page.getByLabel("CSV file").setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByText("1 row has problems — see the list below.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "The mobile number doesn't look right (10 digits, e.g. 98450 12345)." })).toBeVisible();
    await page.getByLabel(/Leave out the 1 row with problems/).check();
    await page.getByRole("button", { name: "Check the file" }).click();
    await page.getByRole("button", { name: "Import 1 leads" }).click();
    await expect(page.getByText(/Imported 1\. 1 rows with problems were left out\./)).toBeVisible();
  });

  test("an Excel file gets Save-As-CSV steps instead of an error", async ({ page }) => {
    await open(page, "/leads/import");
    await page.getByLabel("CSV file").setInputFiles({ name: "leads.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK") });
    await expect(page.getByText(/This is an Excel file/)).toBeVisible();
  });

  test("home is the sales dashboard", async ({ page }) => {
    await open(page, "/home");
    await expect(page.getByText("New leads", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stage funnel" })).toBeVisible();
  });
});

test.describe("hand-over to reception", () => {
  test("reception registers a lead: the form starts from the lead and the two are linked", async ({ browser }) => {
    const phone = uniquePhone();
    const name = `E2E Handover ${Date.now()}`;
    const manager = await browser.newPage({ storageState: STATE.manager });
    await newLead(manager, name, phone);
    await expect(manager.getByRole("heading", { level: 1 })).toHaveText(name);
    const leadId = manager.url().split("/").pop()!;

    const reception = await browser.newPage({ storageState: STATE.reception });
    await open(reception, `/patients/new?lead=${leadId}`);
    await expect(reception.getByText(/Registering lead #\d+ from sales/)).toBeVisible();
    await expect(reception.getByLabel("Full name")).toHaveValue(name);
    await reception.getByRole("button", { name: "Save patient" }).first().click();
    await expect(reception.getByText(/Registered ✓ — UHID/)).toBeVisible();

    await manager.reload();
    await expect(manager.getByText("Not registered yet")).toHaveCount(0);
    await expect(manager.getByText(name).last()).toBeVisible();
    await manager.close();
    await reception.close();
  });
});

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("Meta lead ads: an empty question row is explained, not saved", async ({ page }) => {
    await open(page, "/admin/meta-leads");
    await expect(page.getByLabel("Callback URL")).toHaveValue(/\/functions\/v1\/meta-leads$/);
    await page.getByRole("button", { name: "Add a question" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Please fill this in.")).toBeVisible();
    await expect(page.getByText("Please choose one.")).toBeVisible();
  });
});
