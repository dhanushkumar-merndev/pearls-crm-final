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
  expect(scroll, `${path} is ${scroll - client}px wider than the screen`).toBeLessThanOrEqual(client + 1);
}

const PAGES = {
  reception: ["/home", "/patients", "/appointments", "/bills", "/whatsapp", "/patients/qr"],
  admin: ["/dashboard", "/admin", "/admin/settings"],
  manager: ["/leads", "/leads/dashboard"],
} as const;

for (const [role, paths] of Object.entries(PAGES) as [keyof typeof PAGES, readonly string[]][]) {
  test.describe(`${role} at phone width`, () => {
    test.use({ storageState: STATE[role] });
    for (const path of paths) test(`${path} fits the screen`, ({ page }) => noSidewaysScroll(page, path));
  });
}

test.describe("patient file at phone width", () => {
  test.use({ storageState: STATE.reception });

  test("a patient file fits the screen (tabs scroll in their own row)", async ({ page }) => {
    await page.goto("/patients");
    const fileLink = () =>
      page
        .locator('a[href^="/patients/"]')
        .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? "").find((h) => /^\/patients\/[0-9a-f-]{36}$/.test(h)));
    await expect.poll(fileLink, { timeout: 15_000 }).toBeTruthy();
    const href = await fileLink();
    await noSidewaysScroll(page, href!);
    // The tab bar keeps one row and scrolls sideways instead of wrapping.
    const tabs = page.getByRole("tablist");
    const box = await tabs.boundingBox();
    expect(box!.height).toBeLessThan(60);
  });
});
