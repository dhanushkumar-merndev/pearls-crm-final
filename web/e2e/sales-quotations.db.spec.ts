import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { pickDate, STATE, uniquePhone } from "./helpers";

// Owner 20/11/2026: sales make a quotation (treatments + total) and send it from their own WhatsApp;
// bookings on the lead page have the same Actions as the Appointments page (confirm, reschedule,
// cancel). Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.manager });
test.setTimeout(120_000);

/** A Monday 1–8 weeks ahead (demo doctors work Mon–Sat). */
function aMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7 * randomInt(0, 8));
  return d.toISOString().slice(0, 10);
}

async function newLead(page: Page, name: string) {
  await page.goto("/leads?new=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Mobile", { exact: true }).fill(uniquePhone());
  await dialog.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name, { timeout: 30_000 });
}

test("quotation: checked before saving, priced from the list, sent on WhatsApp, previewed and in the history", async ({ page, context }) => {
  // wa.me is outside: answer it here so the test never leaves the machine.
  await context.route(/https:\/\/(wa\.me|api\.whatsapp\.com)\/.*/, (route) => route.fulfill({ body: "whatsapp" }));
  const name = `E2E Quote ${Date.now()}`;
  await newLead(page, name);

  const card = page.getByTestId("quotations");
  await expect(card.getByText("No quotation yet.", { exact: false })).toBeVisible();
  await card.getByRole("button", { name: "New quotation" }).click();
  const dialog = page.getByRole("dialog");

  // Empty: nothing is sent, the form says what's missing.
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByText("Add at least one line.")).toBeVisible();

  // From the price list: the price fills in.
  await dialog.getByRole("combobox", { name: "Add a treatment" }).click();
  await page.getByPlaceholder("Type to search…").fill("Laser hair");
  await page.getByRole("option", { name: /Laser hair reduction — 6 sessions/ }).click();
  await expect(dialog.getByText("Add at least one line.")).toHaveCount(0);
  await expect(dialog.getByLabel("Treatment", { exact: true }).first()).toHaveValue("Laser hair reduction — 6 sessions");

  // A typed line, and a discount that is too big.
  await dialog.getByRole("button", { name: "Add other line" }).click();
  await dialog.getByLabel("Treatment", { exact: true }).nth(1).fill("PRP");
  await dialog.getByLabel("Qty", { exact: true }).nth(1).fill("2");
  await dialog.getByLabel("Price (each)").nth(1).fill("1500");
  await dialog.getByLabel("Discount", { exact: true }).fill("99999999");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByText("The discount can't be more than the lines add up to.")).toBeVisible();
  await dialog.getByLabel("Discount", { exact: true }).fill("500");

  // Save & send: the salesperson's own WhatsApp opens on the lead's chat with the quotation typed in.
  const popup = context.waitForEvent("page");
  await dialog.getByRole("button", { name: "Save & send on WhatsApp" }).click();
  const chat = await popup;
  await expect.poll(() => chat.url()).toMatch(/wa\.me\/91\d{10}\?text=/);
  const text = decodeURIComponent(new URL(chat.url()).searchParams.get("text") ?? "");
  expect(text).toContain("Laser hair reduction — 6 sessions");
  expect(text).toContain("• PRP × 2 — ₹3,000.00");
  expect(text).toContain("Discount — −₹500.00");
  expect(text).toMatch(/\*Total — ₹[\d,]+\.\d{2}\*/);
  await chat.close();

  await expect(page.getByText("Quotation saved ✓ — WhatsApp opened, press Send there.")).toBeVisible();
  await expect(card.getByText(/^Quotation 1 · ₹/)).toBeVisible();
  await expect(card.getByText("Sent once on WhatsApp")).toBeVisible();

  // Preview: as it prints.
  await card.getByRole("button", { name: "Preview" }).click();
  const peek = page.getByRole("dialog");
  await expect(peek.getByRole("heading", { name: "Quotation preview" })).toBeVisible();
  await expect(peek.frameLocator('[data-testid="print-preview"]').getByText("PRP")).toBeVisible();
  await expect(peek.frameLocator('[data-testid="print-preview"]').getByText(name)).toBeVisible();
  await page.keyboard.press("Escape");

  // Sending again from the list counts again; both show in the history.
  const again = context.waitForEvent("page");
  await card.getByRole("button", { name: "Send quotation 1 on WhatsApp" }).click();
  await (await again).close();
  await expect(card.getByText("Sent 2 times on WhatsApp")).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText(/Quotation 1 made — ₹/)).toBeVisible();
  await expect(page.getByText("Quotation 1 sent on WhatsApp").first()).toBeVisible();
});

test("lead page bookings: confirm, reschedule and cancel from the same Actions menu", async ({ page }) => {
  const name = `E2E Lead Booking ${Date.now()}`;
  await newLead(page, name);

  await page.getByRole("button", { name: "Book consultation" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Doctor" }).click();
  await page.getByRole("option", { name: /Dr Arjun/ }).click();
  await pickDate(page, dialog.getByLabel("Day", { exact: true }), aMonday());
  await dialog.getByRole("radio").and(page.locator(":enabled")).first().click();
  await dialog.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.getByText(/Booked ✓/)).toBeVisible();

  await page.getByRole("tab", { name: /Bookings/ }).click();
  const actions = page.getByRole("tabpanel").getByRole("button", { name: `Actions for ${name}` });
  await actions.click();
  await page.getByRole("menuitem", { name: "Mark confirmed" }).click();
  await expect(page.getByText("Confirmed ✓")).toBeVisible();

  await actions.click();
  await page.getByRole("menuitem", { name: "Reschedule…" }).click();
  dialog = page.getByRole("dialog");
  await pickDate(page, dialog.getByLabel("Day", { exact: true }), aMonday());
  await dialog.getByRole("radio").and(page.locator(":enabled")).last().click();
  await dialog.getByRole("button", { name: "Move here" }).click();
  await expect(page.getByText("Rescheduled ✓ — waiting for confirmation")).toBeVisible();

  await actions.click();
  await page.getByRole("menuitem", { name: "Cancel appointment" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel appointment" }).click();
  await expect(dialog.getByText("Please fill this in.")).toBeVisible(); // a reason first
  await dialog.getByLabel("Reason").fill("Patient will come next month");
  await dialog.getByRole("button", { name: "Cancel appointment" }).click();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tabpanel").getByText("Cancelled").first()).toBeVisible();
});
