import { expect, test, type Page } from "@playwright/test";
import { choose, open, STATE } from "./helpers";

// W-LST-01…10: the round ✕ "Clear filters" on every list (TEST_CASES.md). It is hidden while the
// filters are as the page opened, shows once one is changed, and one click puts them all back.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

/** A date a few days back, in IST (YYYY-MM-DD), so a From/To range stays valid and under a year. */
function daysAgo(n: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - n * 86_400_000));
}

type Case = {
  id: string;
  path: string;
  /** Opens the part of the page the list lives on (a tab), if any. */
  before?: (page: Page) => Promise<void>;
  /** Changes one or more filters away from how the page opened. */
  change: (page: Page) => Promise<void>;
  /** Checks the filters are back to how the page opened. */
  reset: (page: Page) => Promise<void>;
};

async function checkClear(page: Page, c: Case) {
  await open(page, c.path);
  await c.before?.(page);
  const clear = page.getByRole("button", { name: "Clear filters" });
  await expect(clear).toHaveCount(0);
  await c.change(page);
  await expect(clear).toBeVisible();
  await clear.click();
  await c.reset(page);
  await expect(clear).toHaveCount(0);
}

const fromChanged: Pick<Case, "change" | "reset"> = {
  change: async (page) => {
    const from = page.getByLabel("From", { exact: true });
    await from.fill(daysAgo(20));
  },
  reset: async (page) => {
    await expect(page.getByLabel("From", { exact: true })).not.toHaveValue(daysAgo(20));
  },
};

test.describe("reception", () => {
  test.use({ storageState: STATE.reception });
  const cases: Case[] = [
    {
      id: "W-LST-01 appointments table",
      path: "/appointments",
      before: (page) => page.getByRole("tab", { name: "Table" }).click(),
      change: async (page) => {
        await page.getByLabel("From", { exact: true }).fill(daysAgo(5));
        await choose(page, page.getByLabel("Sort by"), "Doctor");
      },
      reset: async (page) => {
        await expect(page.getByLabel("From", { exact: true })).toHaveValue(daysAgo(0));
        await expect(page.getByLabel("To", { exact: true })).toHaveValue(daysAgo(0));
      },
    },
    { id: "W-LST-02 sessions to book", path: "/sessions", ...fromChanged },
    {
      id: "W-LST-03 admissions",
      path: "/admissions",
      change: (page) => choose(page, page.getByLabel("Show"), "Discharged"),
      reset: (page) => expect(page.getByLabel("Show")).toHaveText(/Admitted/),
    },
    {
      id: "W-LST-04 bills",
      path: "/bills",
      change: (page) => choose(page, page.getByLabel("Status", { exact: true }), "Cancelled"),
      reset: (page) => expect(page.getByLabel("Status", { exact: true })).toHaveText(/All/),
    },
    {
      id: "W-LST-05 pharmacy stock",
      path: "/pharmacy?tab=stock",
      change: async (page) => {
        await page.getByLabel("Search medicines").fill("zz nothing");
        await choose(page, page.getByLabel("Show"), "Expired stock");
      },
      reset: async (page) => {
        await expect(page.getByLabel("Search medicines")).toHaveValue("");
        await expect(page.getByLabel("Show")).toHaveText(/All/);
      },
    },
    {
      id: "W-LST-06 pharmacy purchases",
      path: "/pharmacy?tab=purchases",
      change: (page) => choose(page, page.getByLabel("Status", { exact: true }), "Draft"),
      reset: (page) => expect(page.getByLabel("Status", { exact: true })).toHaveText(/All/),
    },
  ];
  for (const c of cases) test(`${c.id}: ✕ appears after a change and resets`, ({ page }) => checkClear(page, c));
});

test.describe("admin", () => {
  test.use({ storageState: STATE.admin });
  const cases: Case[] = [
    { id: "W-LST-07 change history (audit)", path: "/admin/audit", ...fromChanged },
    {
      id: "W-LST-08 admin dashboard",
      path: "/dashboard",
      change: (page) => choose(page, page.getByLabel("Period"), "Last 7 days"),
      reset: (page) => expect(page.getByLabel("Period")).toHaveText(/This month/),
    },
  ];
  for (const c of cases) test(`${c.id}: ✕ appears after a change and resets`, ({ page }) => checkClear(page, c));
});

test.describe("sales manager", () => {
  test.use({ storageState: STATE.manager });
  test("W-LST-09 sales dashboard: ✕ appears after a change and resets", ({ page }) =>
    checkClear(page, {
      id: "W-LST-09",
      path: "/leads/dashboard",
      change: (page) => choose(page, page.getByLabel("Period"), "Last 7 days"),
      reset: (page) => expect(page.getByLabel("Period")).toHaveText(/This month/),
    }));
});
