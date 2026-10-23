import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// These run WITHOUT a backend: the login page must still render, explain and be accessible.

// Pixel baselines are compared on the developer PC only: CI's Linux renders font edges
// differently, so they could never match both. CI still checks colours, sizes and a11y.
const visual = !process.env.CI;

test("logged-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login\?next=%2Fhome$/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("the ChatGPT-style dark theme is the default", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(33, 33, 33)"); // #212121
  if (visual) await expect(page).toHaveScreenshot("login-dark.png");
});

test("the light theme works too", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/light/);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
  if (visual) await expect(page).toHaveScreenshot("login-light.png");
});

for (const theme of ["dark", "light"] as const) {
  test(`login page has no serious accessibility problems (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test("the form can be used with the keyboard only", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").focus();
  await page.keyboard.type("reception2");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.type("not-the-password1");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Show password" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
});

test("buttons and inputs are big enough to tap (≥ 44 px)", async ({ page }) => {
  await page.goto("/login");
  for (const locator of [
    page.getByLabel("Username"),
    page.getByLabel("Password", { exact: true }),
    page.getByRole("button", { name: "Log in" }),
    page.getByRole("button", { name: "Show password" }),
  ]) {
    const box = await locator.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("without a server, the person is told the connection is the problem", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DB), "a backend is running");
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("Pearl@2026");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#login-error")).toContainText("Can't reach the server");
});

test("forgot password: the admin sets a new one (no email links)", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await expect(page.getByText("Ask your admin to set a new password")).toBeVisible();
});

test("the patient's QR form explains itself when the server can't be reached", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DB), "a backend is running");
  await page.goto(`/r/${"a".repeat(48)}`);
  await expect(page.getByText("Something went wrong. Please ask at reception.")).toBeVisible();
});
