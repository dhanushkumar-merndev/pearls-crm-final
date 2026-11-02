import { expect, test, type Page } from "@playwright/test";
import { open, STATE, uniquePhone } from "./helpers";

// Owner, 02/11/2026: the doctor's handwritten prescription is uploaded on the session (or visit) it
// belongs to, and saved there by itself. Needs a backend (E2E_DB=1) with file storage.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.skip(Boolean(process.env.E2E_NO_FILE_STORAGE), "no file storage on this backend (E2E_NO_FILE_STORAGE)");
test.use({ storageState: STATE.reception });
test.setTimeout(120_000);

/** A fake prescription photo, drawn in the browser (never a real document). */
async function fakePrescription(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 1200;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgb(240, 240, 235)";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "rgb(30, 30, 60)";
    g.font = "40px sans-serif";
    for (let i = 0; i < 10; i++) g.fillText(`Rx ${Date.now() % 1000}-${i} fake cream twice daily`, 60, 120 + i * 90);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

test("treatment session: Add prescription saves it on that session", async ({ page }) => {
  const name = `E2E Rx ${Date.now()}`;
  await open(page, "/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByRole("button", { name: "Save patient" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name, { timeout: 30_000 });

  await page.getByRole("tab", { name: "Care" }).click();
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

  await session1.getByRole("button", { name: "Add prescription for session 1" }).click();
  const scan = page.getByRole("dialog");
  await expect(scan.getByTestId("scan-for")).toHaveText(/Laser hair reduction — 6 sessions — Session 1/);
  await expect(scan.getByRole("combobox", { name: "Type" })).toHaveText(/Prescription/);
  await scan.getByLabel("Choose photos or PDF files").setInputFiles({ name: "rx.jpg", mimeType: "image/jpeg", buffer: await fakePrescription(page) });
  await expect(scan.getByRole("img", { name: "Page 1" })).toBeVisible({ timeout: 30_000 });
  await scan.getByRole("button", { name: "Save document (1 page)" }).click();

  // Uploaded in the background, then shown on the session itself…
  await expect(session1.getByRole("button", { name: "Open Prescription (session 1)" })).toBeVisible({ timeout: 60_000 });
  // …and in Documents, saying what it is for.
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page.getByRole("cell", { name: /Laser hair reduction — 6 sessions — session 1/ })).toBeVisible();
});
