import { randomInt, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

export const PASSWORD = process.env.E2E_PASSWORD ?? "Pearl@2026";

/** Saved logins made once by auth.setup.ts (avoids Supabase's sign-in rate limit). */
export const STATE = {
  admin: "e2e/.auth/admin.json",
  reception: "e2e/.auth/reception.json",
  manager: "e2e/.auth/manager.json",
  // Phone-app roles: the web sends them to "Please use the mobile app".
  sales: "e2e/.auth/sales.json",
  bdm: "e2e/.auth/bdm.json",
} as const;

/** Roles that work in the phone app, not the web. */
export const PHONE_ROLES = new Set<string>(["sales", "bdm"]);

/** A random valid Indian mobile — unique even when tests start in the same millisecond. */
export { randomUUID };

export function uniquePhone(): string {
  return `9${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
}

export async function login(page: Page, username: string, expectUrl: RegExp = /\/home$/) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  // Signing in is the slowest call on the free staging project when several browsers share it.
  await expect(page).toHaveURL(expectUrl, { timeout: 30_000 });
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

/**
 * Patient file → Bills → "New bill" / "New pharmacy bill": answers "What is this bill for?" (default
 * "Nothing in particular") and makes it; the bill's page opens.
 */
export async function newBill(page: Page, button: "New bill" | "New pharmacy bill", forOption = "Nothing in particular") {
  await page.getByRole("button", { name: button }).click();
  const dialog = page.getByRole("dialog");
  await choose(page, dialog.getByRole("combobox", { name: "What is this bill for?" }), forOption);
  await dialog.getByRole("button", { name: "Make bill" }).click();
}

/** NEXT_PUBLIC_SUPABASE_* from the environment (CI) or web/.env.local (this computer). */
function backend(): { url: string; anonKey: string } {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) {
    const file = join(process.cwd(), ".env.local");
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const at = line.indexOf("=");
        if (at < 0) continue;
        const k = line.slice(0, at).trim();
        const v = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, "");
        if (k === "NEXT_PUBLIC_SUPABASE_URL") url ||= v;
        if (k === "NEXT_PUBLIC_SUPABASE_ANON_KEY") anonKey ||= v;
      }
    }
  }
  return { url, anonKey };
}

/**
 * Calls an RPC as the person logged in on [page] (their session cookie), for test fixtures
 * that have no web screen (e.g. what the phone app sends). RLS and role checks apply as usual.
 */
export async function rpcAs<T>(page: Page, fn: string, args: Record<string, unknown>): Promise<T> {
  const { url, anonKey } = backend();
  const res = await page.request.post(`${url}/rest/v1/rpc/${fn}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${await accessToken(page)}`, "Content-Type": "application/json" },
    data: args,
  });
  if (!res.ok()) throw new Error(`${fn}: HTTP ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Reads rows as the person logged in on [page] (RLS applies), e.g. `selectAs(page, "clinic_settings?branch_code=eq.main")`. */
/** Calls an Edge Function as the person logged in on [page]; returns the HTTP status and body text. */
export async function functionAs(page: Page, name: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const { url, anonKey } = backend();
  const res = await page.request.post(`${url}/functions/v1/${name}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${await accessToken(page)}`, "Content-Type": "application/json" },
    data: body,
  });
  return { status: res.status(), text: await res.text() };
}

export async function selectAs<T>(page: Page, query: string): Promise<T[]> {
  const { url, anonKey } = backend();
  const res = await page.request.get(`${url}/rest/v1/${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${await accessToken(page)}` },
  });
  if (!res.ok()) throw new Error(`${query}: HTTP ${res.status()} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function accessToken(page: Page): Promise<string> {
  const parts = (await page.context().cookies())
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let raw = decodeURIComponent(parts.map((c) => c.value).join(""));
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice("base64-".length), "base64").toString("utf8");
  return (JSON.parse(raw) as { access_token: string }).access_token;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A themed DatePicker (components/ui/date-picker.tsx): opens it, jumps to the month with the
 * caption's Year / Month lists (when the day isn't on screen), clicks the day and presses OK.
 * `iso` is "YYYY-MM-DD".
 */
export async function pickDate(page: Page, field: Locator, iso: string, title = "Pick a date") {
  await field.click();
  const picker = page.getByRole("dialog", { name: title });
  await (await showDay(page, picker, iso)).click();
  await picker.getByRole("button", { name: "OK", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(field).toHaveAttribute("data-value", iso);
}

/** A themed MonthPicker: steps to the year, clicks the month and presses OK. `ym` is "YYYY-MM". */
export async function pickMonth(page: Page, field: Locator, ym: string, title = "Pick a month") {
  await field.click();
  const picker = page.getByRole("dialog", { name: title });
  const target = picker.locator(`[data-month="${ym}"]`);
  for (let i = 0; i < 100 && (await target.count()) === 0; i++) {
    const shown = (await picker.locator("[data-month]").first().getAttribute("data-month"))!;
    await picker.getByRole("button", { name: ym < shown ? "Previous year" : "Next year" }).click();
  }
  await target.click();
  await picker.getByRole("button", { name: "OK", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(field).toHaveAttribute("data-value", ym);
}

/** Jumps the calendar's first month caption to `iso`'s month (only when that day isn't on screen). */
async function showDay(page: Page, picker: Locator, iso: string) {
  const cell = picker.locator(`td[data-day="${iso}"]:not([data-outside]) button`);
  if ((await cell.count()) > 0) return cell.first();
  await choose(page, picker.getByRole("combobox", { name: "Year" }).first(), iso.slice(0, 4));
  await choose(page, picker.getByRole("combobox", { name: "Month" }).first(), MONTHS[Number(iso.slice(5, 7)) - 1]!);
  return cell.first();
}

/**
 * A themed DateRangePicker ("Dates" on list screens): click the first day, then the last, then OK.
 * `from` / `to` are "YYYY-MM-DD".
 */
export async function pickRange(page: Page, field: Locator, from: string, to: string, title = "Pick dates") {
  await field.click();
  const picker = page.getByRole("dialog", { name: title });
  await (await showDay(page, picker, from)).click();
  await (await showDay(page, picker, to)).click();
  await picker.getByRole("button", { name: "OK", exact: true }).click();
  await expect(picker).toBeHidden();
  // A range picked backwards is put in order.
  await expect(field).toHaveAttribute("data-value", from <= to ? `${from}..${to}` : `${to}..${from}`);
}

/** "14:05" → "2:05 PM" (the time list's labels). */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** A themed TimePicker (a dropdown). `hhmm` is "HH:mm" on the list's step (15 min by default). */
export async function pickTime(page: Page, field: Locator, hhmm: string) {
  await choose(page, field, timeLabel(hhmm));
}

/** A themed DateTimePicker: day, then the time list, then OK. `value` is "YYYY-MM-DDTHH:mm". */
export async function pickDateTime(page: Page, field: Locator, value: string, title = "Pick a date and time") {
  const [iso, hhmm] = value.split("T") as [string, string];
  await field.click();
  const picker = page.getByRole("dialog", { name: title });
  await (await showDay(page, picker, iso)).click();
  await choose(page, picker.getByRole("combobox", { name: "Time" }), timeLabel(hhmm));
  await picker.getByRole("button", { name: "OK", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(field).toHaveAttribute("data-value", value);
}
