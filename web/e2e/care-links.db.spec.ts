import { expect, test } from "@playwright/test";
import { choose, open, STATE, uniquePhone } from "./helpers";

// Owner, 02/11/2026: "can't tell this bill is for session 3 of surgery 1". Patient file → Care shows each
// treatment's sessions with their bills and the money; every bill says what it is for.
// Needs a backend (E2E_DB=1) with the care-links database update.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });
test.setTimeout(120_000);

test("a session's bill says which session it is for, and the treatment shows its money", async ({ page }) => {
  const name = `E2E Care ${Date.now()}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name, { timeout: 30_000 });

  // One Care tab: treatments, IP stays, visits and bookings.
  await page.getByRole("tab", { name: "Care" }).click();
  await expect(page).toHaveURL(/[?&]tab=care/);
  for (const section of ["Treatments and surgeries", "IP stays", "Visits and bookings"]) {
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
  }
  await page.getByRole("button", { name: "Start treatment" }).click();
  const start = page.getByRole("dialog");
  await start.getByRole("combobox", { name: "Treatment" }).click();
  await page.getByPlaceholder("Type to search…").fill("Laser hair");
  await page.getByRole("option", { name: /Laser hair reduction — 6 sessions/ }).click();
  await start.getByRole("button", { name: "Start treatment" }).click();
  await expect(page.getByText("0 of 6 done")).toBeVisible();

  const session1 = page.getByRole("listitem").filter({ hasText: "Session 1" });
  await session1.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("1 of 6 done")).toBeVisible();

  // "Bill" on the session: the bill opens already saying what it is for…
  await session1.getByRole("button", { name: "Make a bill for session 1" }).click();
  await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}\?back=/);
  await expect(page.getByTestId("bill-for")).toHaveText(/For: Laser hair reduction — 6 sessions · Session 1/);
  // …and Back returns to the Care tab, where the session shows its bill.
  await page.getByRole("link", { name: "Back" }).first().click();
  await expect(page).toHaveURL(/[?&]tab=care/);
  await expect(session1.getByRole("link", { name: /Open bill Draft \(Procedure receipt\)/ })).toBeVisible();

  // A part payment for the package counts towards the treatment.
  await page.getByRole("button", { name: "Part payment" }).click();
  const pay = page.getByRole("dialog");
  await expect(pay.getByRole("heading", { name: /Part payment for Laser hair reduction/ })).toBeVisible();
  await choose(page, pay.getByRole("combobox", { name: "Mode" }), "Cash");
  await pay.getByLabel("Amount").fill("1000");
  await pay.getByRole("button", { name: "Save advance" }).click();
  await expect(page.getByTestId("treatment-money")).toContainText("Paid ₹1,000.00");

  // Bills tab: the For column; a new bill first asks what it is for.
  await page.getByRole("tab", { name: "Bills" }).click();
  await expect(page.getByRole("cell", { name: /Laser hair reduction — 6 sessions · Session 1/ })).toBeVisible();
  await page.getByRole("button", { name: "New bill" }).click();
  const make = page.getByRole("dialog");
  await make.getByRole("button", { name: "Make bill" }).click();
  await expect(make.getByText("Please choose one.")).toBeVisible();
  await choose(page, make.getByRole("combobox", { name: "What is this bill for?" }), "Laser hair reduction — 6 sessions (whole treatment)");
  await make.getByRole("button", { name: "Make bill" }).click();
  await expect(page.getByTestId("bill-for")).toHaveText(/For: Laser hair reduction — 6 sessions/);
});

test("old links to the Treatments / IP stays / Appointments tabs open Care", async ({ page }) => {
  await open(page, "/patients");
  await page.getByRole("link").filter({ hasText: /^E2E / }).first().click();
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}/);
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?tab=treatments`);
  await expect(page.getByRole("tab", { name: "Care" })).toHaveAttribute("aria-selected", "true");
  await page.goto(`${url.pathname}?tab=ip`);
  await expect(page.getByRole("tab", { name: "Care" })).toHaveAttribute("aria-selected", "true");
});
