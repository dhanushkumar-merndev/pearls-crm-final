import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import { pickDate, STATE, uniquePhone } from "./helpers";

// Owner 20/11/2026: "booking or appointment, where to see?" — sales get a Bookings page with their
// leads' bookings (upcoming / to confirm / past) and the same Actions as the lead page.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.manager });
test.setTimeout(120_000);

/** A Monday 1–8 weeks ahead (demo doctors work Mon–Sat). */
function aMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7 * randomInt(0, 8));
  return d.toISOString().slice(0, 10);
}

test("bookings: a new booking shows under Upcoming and To confirm; confirming it moves it out of To confirm", async ({ page }) => {
  const name = `E2E Bookings ${Date.now()}`;
  await page.goto("/leads?new=1");
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill(name);
  await add.getByLabel("Mobile", { exact: true }).fill(uniquePhone());
  await add.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name, { timeout: 30_000 });

  await page.getByRole("button", { name: "Book consultation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Doctor" }).click();
  await page.getByRole("option", { name: /Dr Arjun/ }).click();
  await pickDate(page, dialog.getByLabel("Day", { exact: true }), aMonday());
  await dialog.getByRole("radio").and(page.locator(":enabled")).first().click();
  await dialog.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.getByText(/Booked ✓/)).toBeVisible();

  // In the menu, next to Leads.
  await page.getByRole("navigation").getByRole("link", { name: "Bookings" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Bookings" })).toBeVisible();
  const upcoming = page.getByRole("tabpanel");
  const row = () => page.getByRole("tabpanel").getByTestId("booking-row").filter({ hasText: name });
  // The list is in time order and may be long: load more until our lead shows.
  for (let i = 0; i < 10 && (await row().count()) === 0; i++) {
    const more = upcoming.getByRole("button", { name: /Load more/ });
    if (!(await more.isVisible())) break;
    await more.click();
  }
  await expect(row()).toBeVisible();
  await expect(row().getByText("Waiting for confirmation")).toBeVisible();
  await expect(row().getByRole("link", { name, exact: true })).toHaveAttribute("href", /\/leads\//);

  await page.getByRole("tab", { name: "To confirm" }).click();
  for (let i = 0; i < 10 && (await row().count()) === 0; i++) {
    const more = page.getByRole("tabpanel").getByRole("button", { name: /Load more/ });
    if (!(await more.isVisible())) break;
    await more.click();
  }
  await row().getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Mark confirmed" }).click();
  await expect(page.getByText("Confirmed ✓")).toBeVisible();
  await expect(row()).toHaveCount(0);

  await page.getByRole("tab", { name: "Upcoming" }).click();
  for (let i = 0; i < 10 && (await row().count()) === 0; i++) {
    const more = page.getByRole("tabpanel").getByRole("button", { name: /Load more/ });
    if (!(await more.isVisible())) break;
    await more.click();
  }
  await expect(row().getByText("Confirmed", { exact: true })).toBeVisible();
});
