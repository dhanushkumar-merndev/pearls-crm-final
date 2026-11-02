import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { pickRange, STATE } from "./helpers";

// The themed date pickers (owner, 02/11/2026; components/ui/date-picker.tsx): no browser date boxes.
// A range shows two months on a computer and one month in a bottom sheet on a phone, with quick
// choices, Clear and OK. Nothing changes until OK. Checked on "Sessions to book" (From–To filter).
test.skip(!process.env.E2E_DB, "needs the Supabase backend (E2E_DB=1)");
test.use({ storageState: STATE.reception });

/** YYYY-MM-DD in IST, n days from today. */
function istDay(n: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + n * 86_400_000));
}
const show = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

async function openSessions(page: Page) {
  // (Not open(): at phone width the main menu is behind the ☰ button.)
  await page.goto("/sessions");
  await expect(page.getByRole("heading", { level: 1, name: "Sessions to book" })).toBeVisible();
  const dates = page.getByLabel("Dates", { exact: true });
  // The page opens on today and the next six days.
  await expect(dates).toHaveAttribute("data-value", `${istDay(0)}..${istDay(6)}`);
  await expect(dates).toHaveText(`${show(istDay(0))} – ${show(istDay(6))}`);
  return dates;
}

test("computer: two months, quick choices, OK / Esc / Clear, no axe findings", async ({ page }) => {
  const dates = await openSessions(page);
  await dates.click();
  const picker = page.getByRole("dialog", { name: "Pick dates" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("grid")).toHaveCount(2);
  await expect(picker.getByRole("button", { name: "Last 7 days" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Clear" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "OK", exact: true })).toBeVisible();

  const axe = await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // Esc closes without changing anything.
  await picker.getByRole("button", { name: "Last 7 days" }).click();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(dates).toHaveAttribute("data-value", `${istDay(0)}..${istDay(6)}`);

  // A quick choice + OK sets it, and the ✕ "Clear filters" appears.
  await dates.click();
  await picker.getByRole("button", { name: "Last 7 days" }).click();
  await picker.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dates).toHaveAttribute("data-value", `${istDay(-6)}..${istDay(0)}`);
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();

  // Clear puts the page's starting range back.
  await dates.click();
  await picker.getByRole("button", { name: "Clear" }).click();
  await expect(dates).toHaveAttribute("data-value", `${istDay(0)}..${istDay(6)}`);
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);

  // Two clicks pick a range (backwards too), across months with the caption's lists.
  await pickRange(page, dates, istDay(40), istDay(3));
});

test("phone: one month in a bottom sheet with a quick-choice list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dates = await openSessions(page);
  await dates.click();
  const sheet = page.locator("[data-picker-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Pick dates" })).toBeVisible();
  await expect(sheet.getByRole("grid")).toHaveCount(1);
  // It sits at the bottom edge, full width.
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBe(844);
  // Quick choices are a dropdown here.
  await sheet.getByRole("combobox", { name: "Quick choices" }).click();
  await page.getByRole("option", { name: "Yesterday", exact: true }).click();
  await sheet.getByRole("button", { name: "OK", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(dates).toHaveAttribute("data-value", `${istDay(-1)}..${istDay(-1)}`);
  await expect(dates).toHaveText(show(istDay(-1)));
});
