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

test("IP stay: add several charges at once from the stay page, see the total, find them on the final bill", async ({ page }) => {
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

  // An empty list is checked on the page, before anything is sent.
  await page.getByRole("button", { name: "Add charges" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add charges" }).click();
  await expect(dialog.getByText("Add at least one line.")).toBeVisible();

  // Several at once: two services picked from the list plus a typed charge.
  // (The same service twice is fine: e.g. two doctor visits.)
  await pick(page, dialog.getByRole("combobox", { name: "Add from services" }), "Consultation", /^Consultation/);
  await pick(page, dialog.getByRole("combobox", { name: "Add from services" }), "Consultation", /^Consultation/);
  await dialog.getByRole("button", { name: "Add a typed charge" }).click();
  const list = dialog.getByRole("list", { name: "Charges to add" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByLabel("Charge", { exact: true }).first()).toHaveValue(/Consultation/);

  // The typed row is empty: its own fields are marked, nothing is sent.
  await dialog.getByRole("button", { name: "Add 3 charges" }).click();
  await expect(list.getByRole("listitem").nth(2).getByText("Please fill this in.")).toHaveCount(2);

  // Fill the rows: rates for the picked ones, nursing care 2 × ₹1,500.
  await list.getByLabel("Rate").nth(0).fill("500");
  await list.getByLabel("Rate").nth(1).fill("700");
  await list.getByLabel("Charge", { exact: true }).nth(2).fill("Nursing care");
  await list.getByLabel("Qty").nth(2).fill("2");
  await list.getByLabel("Rate").nth(2).fill("1500");
  await expect(dialog.getByTestId("new-charges-total")).toHaveText("₹4,200.00");

  // Removing a row takes it out of the total.
  await list.getByRole("button", { name: /^Remove / }).nth(1).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(dialog.getByTestId("new-charges-total")).toHaveText("₹3,500.00");

  await dialog.getByRole("button", { name: "Add 2 charges" }).click();
  await expect(page.getByText("2 charges added ✓")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(charges.getByRole("cell", { name: "Nursing care" })).toBeVisible();
  await expect(charges.getByRole("row")).toHaveCount(4); // header, 2 charges, total
  await expect(page.getByTestId("charges-total")).toHaveText("₹3,500.00");

  // Both sit on the stay's one draft final bill.
  await expect(page.getByRole("link", { name: "Final bill", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Final bill", exact: true }).click();
  await expect(page).toHaveURL(/\/bills\//);
  await expect(page.getByLabel("Description").last()).toHaveValue("Nursing care");
});
