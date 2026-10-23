import { expect, test, type Page } from "@playwright/test";
import { open, STATE, uniquePhone } from "./helpers";

// Phase 3: booking from the board, walk-in queue, live updates. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

/** Next Monday as YYYY-MM-DD (demo doctors work Mon–Sat 10:00–13:00 and 14:00–18:00). */
function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

async function newPatient(page: Page, name: string) {
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

async function pickPatient(page: Page, name: string) {
  await page.getByRole("dialog").getByRole("combobox", { name: "Patient" }).click();
  await page.getByPlaceholder("Name, phone or UHID…").fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function openBoard(page: Page, day: string) {
  await open(page, "/appointments");
  await page.getByLabel("Day", { exact: true }).fill(day);
}

test("book from the board; a second desk sees it live", async ({ page, browser }) => {
  const name = `E2E Board ${Date.now()}`;
  await newPatient(page, name);
  const day = nextMonday();

  // A second receptionist watching the same day.
  const other = await browser.newContext({ storageState: STATE.reception });
  const watcher = await other.newPage();
  await openBoard(watcher, day);

  await openBoard(page, day);
  await page.getByRole("button", { name: /Book 2:00 PM with Dr Priya/ }).click();
  await pickPatient(page, name);
  await page.getByRole("dialog").getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.getByText(/Booked ✓/)).toBeVisible();

  await expect(watcher.getByText(name)).toBeVisible({ timeout: 15_000 }); // no reload
  await other.close();
});

test("a walk-in without a free slot joins the queue", async ({ page }) => {
  const name = `E2E Walk-in ${Date.now()}`;
  await newPatient(page, name);
  await open(page, "/home");
  await page.getByRole("button", { name: "Walk-in" }).click();
  await pickPatient(page, name);
  await page.getByRole("button", { name: "Add walk-in" }).click();
  await expect(page.getByText(/Added to the queue — number \d+|Added to the current slot ✓/)).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
});

test("a booking can be confirmed from the patient file", async ({ page }) => {
  const name = `E2E Flow ${Date.now()}`;
  await newPatient(page, name);
  await page.getByRole("button", { name: "Book appointment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Doctor" }).click();
  await page.getByRole("option", { name: /Dr Arjun/ }).click();
  await dialog.getByLabel("Day", { exact: true }).fill(nextMonday());
  await dialog.getByRole("radio", { name: /10:15 AM/ }).click();
  await dialog.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.getByText(/Booked ✓/)).toBeVisible();
  await page.getByRole("tab", { name: "Appointments" }).click();
  await expect(page.getByText("Waiting for confirmation")).toBeVisible();
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Mark confirmed" }).click();
  await expect(page.getByText("Confirmed ✓")).toBeVisible();
});
