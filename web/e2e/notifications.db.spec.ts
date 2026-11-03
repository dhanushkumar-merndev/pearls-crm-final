import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { open, randomUUID, rpcAs, selectAs, STATE } from "./helpers";

// Needs a backend with seed data: local (`pnpm db:start`) or staging (E2E_PASSWORD). E2E_DB=1.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

test.use({ storageState: STATE.admin });

interface Row {
  id: string;
  read_at: string | null;
  link: string | null;
}

// The bell shows the newest 10; "See all notifications" opens every one, with an Unread filter.
// Never presses "Mark all as read" (that would clear the owner's bell on staging).
test("the bell links to every notification; Unread shows only unread; opening one marks it read", async ({ page, browser }) => {
  // A fresh unread one for the admin: the test sales login asks to start the day away (admins are told).
  // An earlier ask today (already read) is declined first, so the next ask makes a new notification.
  const salesCtx = await browser.newContext({ storageState: STATE.sales });
  const sales = await salesCtx.newPage();
  const askAway = () =>
    rpcAs<{ id: string; status: string }>(sales, "day_start_request", {
      p: { client_id: randomUUID(), lat: 12.9806, lng: 77.5946, accuracy: 15, reason: "E2E notifications page" },
    }).catch(() => null);
  const decline = (id: string) => rpcAs(page, "day_start_decide", { p_id: id, p_approve: false, p_note: "E2E notifications page" });
  const unreadFor = async (id: string) =>
    (await selectAs<Row>(page, `notifications?select=id,read_at,link&dedupe_key=like.day_start:${id}:*&read_at=is.null`))[0];
  let ask = await askAway();
  if (ask && !(await unreadFor(ask.id))) {
    if (ask.status === "pending") await decline(ask.id);
    ask = await askAway();
  }
  await salesCtx.close();

  await open(page, "/home");
  await page.getByRole("button", { name: /^Notifications:/ }).click();
  await page.getByRole("menuitem", { name: "See all notifications" }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  const list = page.getByRole("list", { name: "Notifications" });
  await expect(list.locator("li").first()).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // Unread: every row shown is unread, and the choice stays in the address.
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page).toHaveURL(/show=unread/);
  await expect(list.locator("li").first()).toBeVisible();
  await expect(list.locator("li:not([data-unread])")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page).not.toHaveURL(/show=/);

  // Numbered pages from the server (30 a page): Next moves on and stays in the address.
  const pager = page.getByRole("navigation", { name: "Pages" });
  if (await pager.isVisible()) {
    await expect(pager).toContainText(/Rows 1–30 of \d+/);
    await pager.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/from=30/);
    await expect(pager).toContainText(/Rows 31–/);
    await pager.getByRole("button", { name: "Previous" }).click();
    await expect(page).not.toHaveURL(/from=/);
  }

  // Opening one marks it read. Only the test's own (never a real one in the admin's bell).
  test.skip(!ask, "the test sales login couldn't ask today (its day already started)");
  const mine = await unreadFor(ask!.id);
  test.skip(!mine, "no unread notification from the test's own ask");
  await open(page, "/notifications?show=unread");
  await list.locator(`li[data-id="${mine!.id}"] a`).click();
  await expect(page).toHaveURL(/\/bdm/);
  await expect
    .poll(async () => (await selectAs<Row>(page, `notifications?select=id,read_at&id=eq.${mine!.id}`))[0]?.read_at ?? null)
    .not.toBeNull();
  await open(page, "/notifications?show=unread");
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  await expect(page.locator(`li[data-id="${mine!.id}"]`)).toHaveCount(0);
  // Leave no pending ask behind on the admin's BDM page.
  await decline(ask!.id);
});
