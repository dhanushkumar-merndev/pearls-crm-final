import { expect, test, type Page } from "@playwright/test";
import { choose, open, STATE, uniquePhone } from "./helpers";

// "Add charge" on an IP stay (owner, 02/11/2026): charges go on the stay's draft final bill and
// are listed on the stay page with a running total. E2E_DB=1.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });
test.setTimeout(90_000);

async function pick(page: Page, combobox: ReturnType<Page["getByRole"]>, search: string, option: RegExp) {
  await combobox.click();
  await page.getByPlaceholder("Type to search…").fill(search);
  await page.getByRole("option", { name: option }).first().click();
}

test("IP stay: add charges from the stay page, see the total, find them on the final bill", async ({ page }) => {
  const name = `E2E Charges ${Date.now()}`;

  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await choose(page, page.getByLabel("Gender"), "Male");
  await page.getByLabel("Age (years)").fill("40");
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  await page.getByRole("tab", { name: "IP stays" }).click();
  await page.getByRole("button", { name: "Admit", exact: true }).click();
  const admit = page.getByRole("dialog");
  await pick(page, admit.getByRole("combobox", { name: "Room type" }), "Semi", /Semi deluxe room/);
  await admit.getByRole("button", { name: "Admit", exact: true }).click();
  await expect(page).toHaveURL(/\/admissions\/[0-9a-f-]{36}$/);

  // Nothing yet: the list says how to add one.
  const charges = page.getByTestId("stay-charges");
  await expect(charges.getByText(/No charges yet/)).toBeVisible();

  // An empty form is checked on the page, before anything is sent.
  await page.getByRole("button", { name: "Add charge" }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add charge" }).click();
  await expect(dialog.getByText("Please fill this in.")).toHaveCount(2); // the charge and its rate
  await expect(dialog.getByLabel("Charge", { exact: true })).toBeFocused();

  // A typed charge: nursing care, 2 × ₹1,500.
  await dialog.getByLabel("Charge", { exact: true }).fill("Nursing care");
  await dialog.getByLabel("Qty").fill("2");
  await dialog.getByLabel("Rate").fill("1500");
  await dialog.getByRole("button", { name: "Add charge" }).click();
  await expect(page.getByText("Charge added ✓")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name: "Nursing care" })).toBeVisible();
  await expect(page.getByTestId("charges-total")).toHaveText("₹3,000.00");

  // A second one picked from the services list (its name fills the charge).
  await page.getByRole("button", { name: "Add charge" }).first().click();
  dialog = page.getByRole("dialog");
  await pick(page, dialog.getByRole("combobox", { name: "Service (optional)" }), "Consultation", /^Consultation/);
  await expect(dialog.getByLabel("Charge", { exact: true })).toHaveValue(/Consultation/);
  await dialog.getByLabel("Rate").fill("500");
  await dialog.getByRole("button", { name: "Add charge" }).click();
  await expect(page.getByText("Charge added ✓").first()).toBeVisible();
  await expect(charges.getByRole("row")).toHaveCount(4); // header, 2 charges, total
  await expect(page.getByTestId("charges-total")).not.toHaveText("₹3,000.00");

  // Both sit on the stay's one draft final bill.
  await expect(page.getByRole("link", { name: "Final bill", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Final bill", exact: true }).click();
  await expect(page).toHaveURL(/\/bills\//);
  await expect(page.getByLabel("Description").first()).toHaveValue("Nursing care");
});
