import { expect, test, type Page } from "@playwright/test";
import { STATE } from "./helpers";

// UI polish: at phone width (the "phone" project, 390 px) no signed-in page is wider than the
// screen — nothing makes the whole page scroll sideways (wide tables scroll inside their own box).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

async function noSidewaysScroll(page: Page, path: string) {
  // (At phone width the main menu sits behind the ☰ button, so wait for the page's title instead.)
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  // Once the data (and any chart) has loaded: late content is what usually overflows.
  await expect(page.getByText(/^(Loading…|Loading chart…)$/)).toHaveCount(0, { timeout: 20_000 });
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.scrollingElement!.scrollWidth,
    client: document.scrollingElement!.clientWidth,
  }));
  expect(scroll, `${path} is ${scroll - client}px wider than the screen`).toBeLessThanOrEqual(
    client + 1,
  );
}

const PAGES = {
  reception: ["/home", "/patients", "/appointments", "/bills", "/whatsapp", "/patients/qr"],
  admin: ["/dashboard", "/admin", "/admin/settings"],
  manager: ["/leads", "/leads/dashboard"],
} as const;

for (const [role, paths] of Object.entries(PAGES) as [keyof typeof PAGES, readonly string[]][]) {
  test.describe(`${role} at phone width`, () => {
    test.use({ storageState: STATE[role] });
    for (const path of paths)
      test(`${path} fits the screen`, ({ page }) => noSidewaysScroll(page, path));
  });
}

test.describe("patient file at phone width", () => {
  test.use({ storageState: STATE.reception });

  test("a patient file fits the screen (tabs scroll in their own row)", async ({ page }) => {
    await page.goto("/patients");
    const fileLink = () =>
      page
        .locator('a[href^="/patients/"]')
        .evaluateAll((links) =>
          links
            .map((a) => a.getAttribute("href") ?? "")
            .find((h) => /^\/patients\/[0-9a-f-]{36}$/.test(h)),
        );
    await expect.poll(fileLink, { timeout: 15_000 }).toBeTruthy();
    const href = await fileLink();
    await noSidewaysScroll(page, href!);
    // The tab bar keeps one row and scrolls sideways instead of wrapping.
    const tabs = page.getByRole("tablist");
    const box = await tabs.boundingBox();
    expect(box!.height).toBeLessThan(60);
  });
});

// Page tops at phone width (owner, 03/11/2026): the description waits behind ⓘ, only the first
// button shows beside the title (the rest behind ⋯), and search + Filters + Refresh share one row.
test.describe("page tops at phone width", () => {
  // The admin: Sync now / Import past leads are theirs only (03/11/2026).
  test.use({ storageState: STATE.admin });

  for (const [path, first, rest] of [
    ["/ads", "Sync now", "Import past leads"],
    ["/leads", "New lead", "Dashboard"],
  ] as const) {
    test(`${path}: description behind ⓘ, first button + ⋯, one search row`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

      const description = page.locator("header p.max-w-prose");
      await expect(description).toBeHidden();
      const text = (await description.textContent())!.trim();
      expect(text.length).toBeGreaterThan(10);
      await page.getByRole("button", { name: "About this page" }).click();
      await expect(page.getByRole("dialog")).toContainText(text);
      await page.keyboard.press("Escape");

      const header = page.locator("header", { has: page.getByRole("heading", { level: 1 }) });
      await expect(
        header.getByRole("button", { name: first }).or(header.getByRole("link", { name: first })),
      ).toBeVisible();
      const other = header
        .getByRole("button", { name: rest })
        .or(header.getByRole("link", { name: rest }));
      await expect(other).toBeHidden();
      await header.getByRole("button", { name: "More actions" }).click();
      await expect(other).toBeVisible();

      // One row: the search box and the Filters button start at about the same height.
      const search = page.getByRole("searchbox").first();
      const filters = page.getByRole("button", { name: /^Filters/ });
      await expect(search).toBeVisible();
      const [a, b] = [await search.boundingBox(), await filters.boundingBox()];
      expect(Math.abs(a!.y + a!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(12);
    });
  }
});
