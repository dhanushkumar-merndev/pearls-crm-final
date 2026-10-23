import { expect, test } from "@playwright/test";
import { open, STATE, uniquePhone } from "./helpers";

// Phase 4: a 6-session package from start to done. Needs a backend (E2E_DB=1).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

test("6-session laser package: start, do every session, completed", async ({ page }) => {
  const name = `E2E Treat ${Date.now()}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  await page.getByRole("tab", { name: "Treatments" }).click();
  await page.getByRole("button", { name: "Start treatment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Treatment" }).click();
  await page.getByPlaceholder("Type to search…").fill("Laser hair");
  await page.getByRole("option", { name: /Laser hair reduction — 6 sessions/ }).click();
  await expect(dialog.getByLabel("Sessions")).toHaveValue("6");
  await dialog.getByRole("button", { name: "Start treatment" }).click();
  await expect(page.getByText("Treatment started ✓")).toBeVisible();
  await expect(page.getByText("0 of 6 done")).toBeVisible();

  for (let n = 1; n <= 6; n++) {
    await page.getByRole("listitem").filter({ hasText: `Session ${n}` }).getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText(`${n} of 6 done`)).toBeVisible();
  }
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
});
