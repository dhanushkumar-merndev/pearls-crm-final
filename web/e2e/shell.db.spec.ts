import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { open, STATE } from "./helpers";

// Needs a backend with seed data: local (`pnpm db:start`) or staging (E2E_PASSWORD). E2E_DB=1.
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");

// These few log in for real (that's what they test); the rest reuse saved sessions.
const PASSWORD = process.env.E2E_PASSWORD ?? "Pearl@2026";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
}

test.describe("admin shell", () => {
  test.use({ storageState: STATE.admin });
  // The theme test changes the admin's saved theme; the others check the default. One at a time.
  test.describe.configure({ mode: "serial" });

  test("admin lands on Home with the ChatGPT-style shell", async ({ page }) => {
    await open(page, "/home");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Asha");
    const menu = page.getByRole("navigation", { name: "Main menu" });
    await expect(menu.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "Design preview" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  test("Ctrl+K search opens and navigates", async ({ page }) => {
    await open(page, "/home");
    await page.keyboard.press("Control+k");
    const search = page.getByPlaceholder("Search name, phone, UHID or lead no.…").last();
    await expect(search).toBeFocused();
    await search.fill("Design");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/design$/);
  });

  test("design preview: charts render and offer a table view", async ({ page }) => {
    await open(page, "/design");
    const card = page.getByRole("region", { name: "Arrivals by hour" });
    await expect(card.locator("svg").first()).toBeVisible();
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("columnheader", { name: "Hour" })).toBeVisible();
    await expect(card.getByRole("row")).toHaveCount(11);
  });

  test("the theme choice is saved and survives a reload", async ({ page }) => {
    await open(page, "/home");
    await page.getByRole("button", { name: /Asha Admin/ }).click();
    const saved = page.waitForResponse((r) => r.url().includes("/rpc/set_my_theme") && r.ok());
    await page.getByRole("menuitemradio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveClass(/light/);
    await saved; // the choice is saved on the profile; reload only once it is stored
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/light/);
    // put it back for other tests
    await page.getByRole("button", { name: /Asha Admin/ }).click();
    const back = page.waitForResponse((r) => r.url().includes("/rpc/set_my_theme") && r.ok());
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await back;
  });
});

test("a receptionist logs in and does not see admin pages", async ({ page }) => {
  await login(page, "reception");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("link", { name: "Design preview" })).toHaveCount(0);
  await page.goto("/design");
  await expect(page.getByText("This page doesn't exist.")).toBeVisible();
});

test("sales executives are pointed to the Android app", async ({ page }) => {
  await login(page, "sales");
  await expect(page).toHaveURL(/\/use-the-app$/);
  await expect(page.getByRole("heading", { name: "Please use the mobile app" })).toBeVisible();
});

test("a wrong password gets a friendly message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#login-error")).toContainText("not right");
});
