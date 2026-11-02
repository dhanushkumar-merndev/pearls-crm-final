import { expect, test, type Page } from "@playwright/test";
import { open, selectAs, STATE, uniquePhone } from "./helpers";

// Owner, 02/11/2026: "open a tab, open something, press Back → I'm on the first tab again".
// Every tabbed page keeps its open tab (and the board its day) in the address, so Back returns to it.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

/** Leaves the page the way staff do (a menu link, no reload), then presses Back. */
async function awayAndBack(page: Page, menuItem: string) {
  await page.getByRole("navigation").getByRole("link", { name: menuItem, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(menuItem);
  await page.goBack();
}

const selected = (page: Page, name: string) => expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");

test.describe("reception", () => {
  test.use({ storageState: STATE.reception });

  test("patient file: Back returns to the open tab", async ({ page }) => {
    const name = `E2E Tabs ${Date.now()}`;
    await open(page, "/patients/new");
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Mobile number").fill(uniquePhone());
    await page.getByRole("button", { name: "Save patient" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name, { timeout: 30_000 }); // slow on shared staging

    await page.getByRole("tab", { name: "Documents", exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=documents/);
    await awayAndBack(page, "Appointments");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await selected(page, "Documents");

    // A full reload (or a copied link) keeps it too.
    await page.reload();
    await selected(page, "Documents");
  });

  test("appointments: Back keeps the Table view, and the board keeps its day", async ({ page }) => {
    await open(page, "/appointments");
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page).toHaveURL(/[?&]day=\d{4}-\d{2}-\d{2}/);
    const day = new URL(page.url()).searchParams.get("day")!;
    await expect(page.getByLabel("Day", { exact: true })).toHaveAttribute("data-value", day);
    await awayAndBack(page, "Follow-ups");
    await expect(page.getByLabel("Day", { exact: true })).toHaveAttribute("data-value", day);

    await page.getByRole("tab", { name: "Table", exact: true }).click();
    await awayAndBack(page, "Follow-ups");
    await selected(page, "Table");
  });

  test("follow-ups: Back keeps the open list", async ({ page }) => {
    await open(page, "/followups");
    await page.getByRole("tab", { name: "Overdue", exact: true }).click();
    await awayAndBack(page, "Appointments");
    await selected(page, "Overdue");
  });
});

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });

  test("lead: Back returns to the open tab", async ({ page }) => {
    await open(page, "/home");
    const [lead] = await selectAs<{ id: string }>(page, "leads?select=id&limit=1");
    if (!lead) test.skip(true, "no lead on this database");
    await open(page, `/leads/${lead!.id}`);
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await awayAndBack(page, "Appointments");
    await selected(page, "History");
  });
});
