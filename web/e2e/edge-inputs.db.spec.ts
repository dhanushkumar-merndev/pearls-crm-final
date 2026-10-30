import { expect, test, type Page } from "@playwright/test";
import { open, selectAs, STATE, uniquePhone } from "./helpers";

// W-EDGE-01…08: input edge cases shared by every form (TEST_CASES.md "Edge cases every form shares"),
// checked on the two busiest forms: the desk's new patient and the manager's new lead.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

/** "98450 12345" style, as people read numbers out. */
const spaced = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;

test.describe("reception: new patient", () => {
  test.use({ storageState: STATE.reception });

  async function fill(page: Page, name: string, phone: string) {
    await open(page, "/patients/new");
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Mobile number").fill(phone);
  }

  test("W-EDGE-01 Save pressed twice quickly still makes one patient", async ({ page }) => {
    const phone = uniquePhone();
    const name = `E2E Twice ${Date.now()}`;
    await fill(page, name, phone);
    await page.getByRole("button", { name: "Save patient" }).first().dblclick();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    const rows = await selectAs<{ id: string }>(page, `patients?phone_last10=eq.${phone}&select=id`);
    expect(rows).toHaveLength(1);
  });

  test("W-EDGE-02 Tamil / Hindi names are kept letter for letter; extra spaces are tidied", async ({ page }) => {
    const stamp = Date.now();
    const name = `E2E முருகன் राम ${stamp}`;
    await fill(page, `   E2E   முருகன்  राम ${stamp}  `, uniquePhone());
    await page.getByRole("button", { name: "Save patient" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  });

  for (const [label, shape] of [
    ["+91 and spaces", (p: string) => `+91 ${spaced(p)}`],
    ["leading 0 and a dash", (p: string) => `0${p.slice(0, 5)}-${p.slice(5)}`],
    ["0091", (p: string) => `0091${p}`],
  ] as const) {
    test(`W-EDGE-03 a number typed with ${label} is saved as +91 and ten digits`, async ({ page }) => {
      const phone = uniquePhone();
      const name = `E2E Phone ${Date.now()}`;
      await fill(page, name, shape(phone));
      await page.getByRole("button", { name: "Save patient" }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      const [row] = await selectAs<{ phone_e164: string }>(page, `patients?phone_last10=eq.${phone}&select=phone_e164`);
      expect(row?.phone_e164).toBe(`+91${phone}`);
    });
  }

  for (const bad of ["12345", "98450123456789", "abcdefghij", "0000000000"]) {
    test(`W-EDGE-04 "${bad}" is refused under the field and nothing is saved`, async ({ page }) => {
      await fill(page, `E2E Bad ${Date.now()}`, bad);
      await page.getByRole("button", { name: "Save patient" }).first().click();
      const field = page.getByLabel("Mobile number");
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toBeFocused();
      await expect(page).toHaveURL(/\/patients\/new/);
    });
  }

  test("W-EDGE-05 a name of only spaces counts as empty", async ({ page }) => {
    await fill(page, "     ", uniquePhone());
    await page.getByRole("button", { name: "Save patient" }).first().click();
    await expect(page.getByLabel("Full name")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/patients\/new/);
  });

  test("W-EDGE-06 the name box takes at most 120 letters (the rest isn't typed in)", async ({ page }) => {
    await fill(page, `E2E ${"x".repeat(130)}`, uniquePhone());
    expect((await page.getByLabel("Full name").inputValue()).length).toBe(120);
  });
});

test.describe("sales manager: new lead", () => {
  test.use({ storageState: STATE.manager });

  test("W-EDGE-07 Save lead pressed twice quickly still makes one lead, with the number cleaned", async ({ page }) => {
    const phone = uniquePhone();
    const name = `E2E Lead Twice ${Date.now()}`;
    await page.goto("/leads?new=1");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Mobile", { exact: true }).fill(`+91 ${spaced(phone)}`);
    await dialog.getByRole("button", { name: "Save lead" }).dblclick();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    const rows = await selectAs<{ phone_e164: string }>(page, `leads?phone_last10=eq.${phone}&select=phone_e164`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phone_e164).toBe(`+91${phone}`);
  });

  test("W-EDGE-08 closing the new-lead form with Escape saves nothing", async ({ page }) => {
    const phone = uniquePhone();
    await page.goto("/leads?new=1");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(`E2E Escape ${Date.now()}`);
    await dialog.getByLabel("Mobile", { exact: true }).fill(phone);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await selectAs(page, `leads?phone_last10=eq.${phone}&select=id`)).toHaveLength(0);
  });
});
