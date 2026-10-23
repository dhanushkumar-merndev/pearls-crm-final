import { randomInt } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";

export const PASSWORD = process.env.E2E_PASSWORD ?? "Pearl@2026";

/** Saved logins made once by auth.setup.ts (avoids Supabase's sign-in rate limit). */
export const STATE = {
  admin: "e2e/.auth/admin.json",
  reception: "e2e/.auth/reception.json",
} as const;

/** A random valid Indian mobile — unique even when tests start in the same millisecond. */
export function uniquePhone(): string {
  return `9${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
}

export async function login(page: Page, username: string, expectUrl: RegExp = /\/home$/) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(expectUrl);
}

/** Opens a page and waits until the app shell is interactive (keyboard shortcuts work). */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("navigation", { name: "Main menu" }).first()).toBeVisible();
}

/** Picks an option in the app's dropdown (components/ui/select.tsx; not a native select). */
export async function choose(page: Page, field: Locator, option: string) {
  await field.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
