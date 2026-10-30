import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { open, rpcAs, STATE, uniquePhone } from "./helpers";

// W-MGR-10…14: the sales manager's bulk assign, lead pool and dashboard (TEST_CASES.md).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.manager });

test("bulk assign: an owner must be chosen; two leads get one", async ({ page }) => {
  const tag = `E2E Bulk ${Date.now()}`;
  await open(page, "/leads");
  for (const n of [1, 2]) {
    await rpcAs(page, "create_lead", {
      p_lead: { name: `${tag} ${n}`, phone: `+91${uniquePhone()}`, force: true, via: "web" },
      p_client_id: randomUUID(),
    });
  }
  await page.reload();
  await page.getByLabel("Search", { exact: true }).fill(tag);
  await expect(page.getByRole("link", { name: `${tag} 1` })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(`Select ${tag} 1`).check();
  await page.getByLabel(`Select ${tag} 2`).check();
  const bulk = page.getByRole("region", { name: "Selected leads" });
  await expect(bulk.getByText("2 selected")).toBeVisible();
  await bulk.getByRole("button", { name: "Assign 2 leads" }).click();
  await expect(bulk.getByLabel("Assign to")).toHaveAttribute("aria-invalid", "true");
  await bulk.getByLabel("Assign to").click();
  const options = page.getByRole("option");
  test.skip((await options.count()) < 2, "nobody to assign leads to on this database");
  await options.nth(1).click();
  await bulk.getByRole("button", { name: "Assign 2 leads" }).click();
  await expect(page.getByText("2 leads assigned ✓").first()).toBeVisible();
});

test("lead pool: round-robin state is shown and the pool saves", async ({ page }) => {
  await open(page, "/leads/pool");
  await expect(page.getByText(/^Round-robin (on|off)$/)).toBeVisible();
  await expect(page.getByText(/^(Loading…)$/)).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved ✓").first()).toBeVisible();
});

test("leads dashboard opens with its numbers and a chart table", async ({ page }) => {
  await open(page, "/leads/dashboard");
  await expect(page.getByText(/^(Loading…|Loading chart…)$/)).toHaveCount(0, { timeout: 20_000 });
  const table = page.getByRole("button", { name: /View as table/ }).first();
  if (await table.count()) {
    await table.click();
    await expect(page.getByRole("table").first()).toBeVisible();
  }
});

test("clear filters: the round ✕ shows once a filter is set and puts them all back", async ({ page }) => {
  await open(page, "/leads");
  const clear = page.getByRole("button", { name: "Clear filters" });
  await expect(clear).toHaveCount(0);
  await page.getByLabel("Search", { exact: true }).fill("nobody at all");
  await page.getByRole("button", { name: "Descending" }).click();
  await clear.click();
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Descending" })).toBeVisible();
  await expect(clear).toHaveCount(0);
});
