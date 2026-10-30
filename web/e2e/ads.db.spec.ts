import { expect, test } from "@playwright/test";
import { choose, open, STATE } from "./helpers";

// Phase 16: Leads → Ads (campaign numbers beside CRM results, a side panel per campaign) and the
// Meta import dialog. Works on an empty database too: the campaign panel is checked when there is one.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.manager });

test("ads page: tiles, filters with clear, campaign side panel", async ({ page }) => {
  await open(page, "/ads");
  await expect(page.getByRole("heading", { name: "Ads", level: 1 })).toBeVisible();
  await expect(page.getByTestId("ads-tiles")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ads-tiles").getByText("Spent")).toBeVisible();
  await expect(page.getByTestId("ads-campaigns")).toBeVisible();

  await choose(page, page.getByLabel("Status"), "Active");
  const clear = page.getByRole("button", { name: "Clear filters" });
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(clear).toHaveCount(0);

  const first = page.getByTestId("ads-campaigns").locator("tbody button").first();
  if (await first.count()) {
    const name = (await first.textContent()) ?? "";
    await first.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name })).toBeVisible();
    await expect(sheet.getByText(/^(\d+ ads?|Ads)$/)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  }
});

test("ads page: the sidebar has it, and Import past leads explains itself", async ({ page }) => {
  await open(page, "/home");
  await page.getByRole("link", { name: "Ads", exact: true }).first().click();
  await expect(page).toHaveURL(/\/ads$/);
  await page.getByRole("button", { name: "Import past leads" }).click();
  const dialog = page.getByRole("dialog", { name: "Import past leads" });
  await expect(dialog.getByText(/no alert per lead and no WhatsApp welcome/)).toBeVisible();
  await expect(dialog.getByLabel("How far back")).toHaveText(/Last 30 days/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("reception has no Ads page", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: STATE.reception });
  const page = await ctx.newPage();
  await page.goto("/ads");
  await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
  await expect(page.getByTestId("ads-tiles")).toHaveCount(0);
  await ctx.close();
});
