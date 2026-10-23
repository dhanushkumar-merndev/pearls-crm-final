import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Needs the local backend with seed data: `pnpm db:start` then `E2E_DB=1 pnpm e2e`.
test.skip(!process.env.E2E_DB, "needs the local Supabase backend (E2E_DB=1)");

const PASSWORD = "Pearl@2026"; // fake seed users (supabase/seed.sql)

async function login(page: Page, identifier: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("admin lands on Home with the ChatGPT-style shell", async ({ page }) => {
  await login(page, "admin@pearl.test");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Asha");
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Design preview" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("Ctrl+K search opens and navigates", async ({ page }) => {
  await login(page, "admin@pearl.test");
  await page.keyboard.press("Control+k");
  const search = page.getByPlaceholder("Search name, phone or UHID…").last();
  await expect(search).toBeFocused();
  await search.fill("Design");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/design$/);
});

test("design preview: charts render and offer a table view", async ({ page }) => {
  await login(page, "admin@pearl.test");
  await page.goto("/design");
  const card = page.getByRole("region", { name: "Arrivals by hour" });
  await expect(card.locator("svg").first()).toBeVisible();
  await card.getByRole("button", { name: "View as table" }).click();
  await expect(card.getByRole("columnheader", { name: "Hour" })).toBeVisible();
  await expect(card.getByRole("row")).toHaveCount(11);
});

test("the theme choice is saved and survives a reload", async ({ page }) => {
  await login(page, "admin@pearl.test");
  await page.getByRole("button", { name: "Asha Admin" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  // put it back for other tests
  await page.getByRole("button", { name: "Asha Admin" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("a receptionist logs in with a username and does not see admin pages", async ({ page }) => {
  await login(page, "reception2");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("link", { name: "Design preview" })).toHaveCount(0);
  await page.goto("/design");
  await expect(page.getByText("This page doesn't exist.")).toBeVisible();
});

test("sales executives are pointed to the Android app", async ({ page }) => {
  await login(page, "sales@pearl.test");
  await expect(page).toHaveURL(/\/use-the-app$/);
  await expect(page.getByRole("heading", { name: "Please use the mobile app" })).toBeVisible();
});

test("a wrong password gets a friendly message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill("admin@pearl.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#login-error")).toContainText("not right");
});
