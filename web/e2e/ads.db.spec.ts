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

test("campaigns table: its own period, up to 24 months, a total of every campaign, 10 per page", async ({ page }) => {
  await open(page, "/ads");
  const table = page.getByTestId("ads-campaigns");
  await expect(table).toBeVisible({ timeout: 20_000 });

  // The page itself: more than a year is fine now, more than 24 months is not.
  await choose(page, page.getByLabel("Period", { exact: true }), "Last 24 months");
  await expect(page.getByTestId("ads-tiles")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Choose at most 24 months.")).toHaveCount(0);

  // The table's own period, with its own dates and check.
  await choose(page, page.getByLabel("Period for this table"), "Choose dates");
  await page.getByLabel("Table from").fill("2023-01-01");
  await expect(page.getByText("Choose at most 24 months.")).toBeVisible();
  await page.getByLabel("Table from").fill("2025-01-01");
  await expect(page.getByText("Choose at most 24 months.")).toHaveCount(0);

  // The total row counts every campaign that passes the filters, not only the page shown.
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const total = page.getByTestId("ads-campaigns-total");
  if (await total.count()) {
    const n = Number((await total.locator("td").first().textContent())?.match(/(\d+) campaigns?/)?.[1]);
    expect(await rows.count()).toBe(Math.min(n, 10));
    if (n > 10) {
      await expect(page.getByText(`Rows 1–10 of ${n}`)).toBeVisible();
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByText(`Rows 11–${Math.min(n, 20)} of ${n}`)).toBeVisible();
      await expect(total).toContainText(`${n} campaigns`);
    }
  }
});

test("Sync now: when the server can't be reached the message says so (and why), not only 'went wrong'", async ({ page }) => {
  // The browser gets no answer at all, as when this web address isn't allowed to call functions (31/10/2026).
  await page.route(/\/functions\/v1\/meta-ads/, (r) => r.abort("failed"));
  await open(page, "/ads");
  const sync = page.getByRole("button", { name: "Sync now" });
  test.skip(!(await sync.count()), "no Sync now for this login");
  await sync.click();
  await expect(page.getByText(/Couldn't reach the server\. .*\(meta-ads: /).first()).toBeVisible({ timeout: 15_000 });
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
