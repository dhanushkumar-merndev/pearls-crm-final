import { expect, test } from "@playwright/test";
import { open, STATE, uniquePhone } from "./helpers";

// Phase 19b (owner, 17/11/2026: "discharge summary for OP also, in the Bills tab"): a summary for a
// treatment session done as OP, started from Bills → Discharge summaries. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });
test.setTimeout(120_000);

test("OP discharge summary: from the Bills tab, filled with the session, finalized and printed", async ({ page }) => {
  const name = `E2E OP Summary ${Date.now()}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name, { timeout: 30_000 });

  // A treatment with session 1 done (no IP stay).
  await page.getByRole("tab", { name: "Care" }).click();
  await page.getByRole("button", { name: "Start treatment" }).click();
  const start = page.getByRole("dialog");
  await start.getByRole("combobox", { name: "Treatment" }).click();
  await page.getByPlaceholder("Type to search…").fill("Laser hair");
  await page.getByRole("option", { name: /Laser hair reduction — 6 sessions/ }).click();
  await start.getByRole("button", { name: "Start treatment" }).click();
  const session1 = page.getByRole("listitem").filter({ hasText: "Session 1" });
  await session1.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("1 of 6 done")).toBeVisible();

  // Bills → Discharge summaries → New: the OP session is offered.
  await page.getByRole("tab", { name: "Bills", exact: true }).click();
  await page.getByRole("tab", { name: "Discharge summaries" }).click();
  await page.getByRole("button", { name: "New discharge summary" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("combobox", { name: "OP visit or IP stay" })).toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("combobox", { name: "OP visit or IP stay" }).click();
  await page.getByRole("option", { name: /^OP · .*Laser hair reduction — 6 sessions, session 1/ }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Start" }).click();

  await expect(page).toHaveURL(/\/discharge\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("summary-op")).toContainText("Laser hair reduction — 6 sessions, session 1");
  await page.getByRole("textbox", { name: /^Text for/ }).first().fill("{{patient_name}} had {{procedure}} on {{procedure_on}}.");
  await expect(page.getByText(`${name} had Laser hair reduction — 6 sessions on`).first()).toBeVisible();
  // IP-only names can't be filled for an OP visit.
  await page.getByRole("textbox", { name: /^Text for/ }).first().fill("Room {{room}}");
  await expect(page.getByText(/Still to fill: room/)).toBeVisible();
  await page.getByRole("textbox", { name: /^Text for/ }).first().fill("{{patient_name}} had {{procedure}} on {{procedure_on}}.");

  // The signing doctor (the treatment may have none): any doctor.
  await page.getByRole("combobox", { name: "Signed by" }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Finalize", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finalize", exact: true }).click();
  await expect(page.getByText("Discharge summary finalized ✓")).toBeVisible();

  const href = await page.getByRole("link", { name: "Print" }).getAttribute("href");
  await page.goto(href!);
  await expect(page.getByText("Original", { exact: true })).toBeVisible();
  await expect(page.getByText("OP (day care)")).toBeVisible();
  await expect(page.getByText(`${name} had Laser hair reduction — 6 sessions on`)).toBeVisible();

  // Listed in the patient's Discharge summaries section as OP.
  await page.goBack();
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page).toHaveURL(/section=discharge/);
  await expect(page.getByTestId("discharge-table").getByRole("row").filter({ hasText: "OP ·" })).toContainText("Finalized");
});
