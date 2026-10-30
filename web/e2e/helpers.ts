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
