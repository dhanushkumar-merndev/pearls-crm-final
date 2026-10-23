import { expect, test, type Page } from "@playwright/test";
import { choose, open, STATE, uniquePhone } from "./helpers";

// Phase 7: admit → interim bill → discharge → final bill (carries the interim bill once, adds
// room nights) → discharge summary from the template ("She underwent…") → print. E2E_DB=1.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });
test.setTimeout(90_000);

async function pick(page: Page, combobox: ReturnType<Page["getByRole"]>, search: string, option: RegExp) {
  await combobox.click();
  await page.getByPlaceholder("Type to search…").fill(search);
  await page.getByRole("option", { name: option }).first().click();
}

test("IP stay: final bill without double counting, discharge summary with the right pronouns", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Stay ${stamp}`;

  // A female patient, 36 years old.
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await choose(page, page.getByLabel("Gender"), "Female");
  await page.getByLabel("Age (years)").fill("36");
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  // Admit with a room, a surgeon and the operation details.
  await page.getByRole("tab", { name: "IP stays" }).click();
  await page.getByRole("button", { name: "Admit", exact: true }).click();
  const admit = page.getByRole("dialog");
  await pick(page, admit.getByRole("combobox", { name: "Room type" }), "Semi", /Semi deluxe room/);
  await admit.getByLabel("Room / bed").fill("SEMI DELUX ROOM/1");
  await admit.getByLabel("Procedures").fill("Septoplasty");
  await admit.getByLabel("Diagnosis").fill("Deviated nasal septum");
  await admit.getByLabel("Anaesthesia").fill("general anaesthesia");
  const admittedAt = await admit.getByLabel("Admitted at").inputValue();
  await admit.getByLabel("Surgery at").fill(admittedAt);
  await pick(page, admit.getByRole("combobox", { name: "Doctor" }), "Dr", /Dr/);
  await admit.getByRole("button", { name: "Admit", exact: true }).click();
  await expect(page).toHaveURL(/\/admissions\/[0-9a-f-]{36}$/);
  const stayUrl = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("IP stay");

  // An interim procedure bill during the stay, paid in full.
  await page.getByRole("button", { name: "Procedure bill" }).click();
  await expect(page).toHaveURL(/\/bills\//);
  await pick(page, page.getByRole("combobox", { name: "Service or item" }).first(), "Consultation", /^Consultation/);
  await page.getByLabel("Rate", { exact: true }).first().fill("500");
  await page.getByRole("button", { name: "Finalize bill" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Mode" }).click();
  await page.getByRole("option", { name: "Cash", exact: true }).click();
  await dialog.getByRole("button", { name: "Fully paid" }).click();
  await expect(page.getByText(/^Bill .+ finalized$/)).toBeVisible();
  const interimNo = (await page.getByRole("heading", { level: 1 }).textContent())!.split("·")[1]!.trim();

  // Discharge.
  await page.goto(stayUrl);
  await page.getByRole("button", { name: "Discharge", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discharge", exact: true }).click();
  await expect(page.getByText("Discharged ✓")).toBeVisible();

  // Final bill: carry the interim bill, add the room nights.
  await page.getByRole("button", { name: "Make final bill" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Final bill");
  await page.getByRole("checkbox", { name: new RegExp(interimNo.replace(/[/]/g, "\\/")) }).check();
  await page.getByRole("button", { name: "Include 1 bill" }).click();
  await expect(page.getByText("Included bills updated")).toBeVisible();
  await expect(page.getByText(`from bill ${interimNo}`).first()).toBeVisible();
  await page.getByRole("button", { name: /^Add 1 charge/ }).click();
  await expect(page.getByText("Charges added")).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue(/Semi deluxe room/);
  await page.getByRole("button", { name: "Finalize bill" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Mode" }).click();
  await page.getByRole("option", { name: "Cash", exact: true }).click();
  await dialog.getByRole("button", { name: "Fully paid" }).click();
  await expect(page.getByText(/^Bill .+ finalized$/)).toBeVisible();
  // Bill amount = room (own) + ₹500 carried; the ₹500 was already received on the interim bill.
  await expect(page.getByText("Carried in", { exact: true })).toBeVisible();

  // Discharge summary from the generic template.
  await page.goto(stayUrl);
  await page.getByRole("button", { name: "Write discharge summary" }).click();
  dialog = page.getByRole("dialog");
  await choose(page, dialog.getByLabel("Start from"), "Septoplasty (generic)");
  await dialog.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/discharge\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Every placeholder is filled ✓")).toBeVisible();
  await expect(page.getByText(/She underwent Septoplasty under general anaesthesia/)).toBeVisible();
  await page.getByRole("button", { name: "Finalize", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finalize", exact: true }).click();
  await expect(page.getByText("Discharge summary finalized ✓")).toBeVisible();

  const href = await page.getByRole("link", { name: "Print" }).getAttribute("href");
  await page.goto(href!);
  await expect(page.getByText("Original", { exact: true })).toBeVisible();
  await expect(page.getByText(/She underwent Septoplasty/)).toBeVisible();
  await expect(page.getByText(/Her post-operative course was uneventful/)).toBeVisible();
});
