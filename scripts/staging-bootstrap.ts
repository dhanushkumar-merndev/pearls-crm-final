/**
 * Prepares the online staging project after `pnpm deploy:supabase` (pnpm staging:bootstrap).
 * Safe to run again: it only adds what is missing.
 *   1. STAGING_TEST_PASSWORD in .env (generated if empty, letters and digits)
 *   2. One fake login per role — usernames admin / reception / manager / sales / bdm
 *      (username + password only, like every staff login), created through the Auth
 *      Admin API; an existing login gets the current password
 *   3. Their public.staff rows
 *   4. supabase/seed/02_demo_settings.sql (fake demo clinic and libraries; skips what exists)
 * Passwords and keys are never printed.
 */
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { toLoginEmail } from "../packages/shared/src/auth.ts";
import { setEnvValues } from "./env-set.ts";
import { need, project, root } from "./supabase-api.ts";

// Same fake names as supabase/seed/01_users.sql, so the browser tests read the same online.
const USERS = [
  { username: "admin", role: "admin", fullName: "Asha Admin", phone: "+919000000001" },
  { username: "reception", role: "receptionist", fullName: "Rekha Reception", phone: "+919000000002" },
  { username: "manager", role: "sales_manager", fullName: "Manoj Manager", phone: "+919000000003" },
  { username: "sales", role: "sales_executive", fullName: "Sunil Sales", phone: "+919000000004" },
  { username: "bdm", role: "bdm", fullName: "Bhavya BDM", phone: "+919000000005" },
].map((u) => ({ ...u, email: toLoginEmail(u.username) }));

function generatePassword(length = 20): string {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const chars = Array.from({ length }, () => all[randomInt(all.length)]!);
  // Guarantee both kinds the password rule asks for.
  chars[0] = letters[randomInt(letters.length)]!;
  chars[1] = digits[randomInt(digits.length)]!;
  return chars.join("");
}

const { env, url, apiKey } = project();
const [databaseUrl] = need(env, "DATABASE_URL");
if (/@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl!)) {
  console.error("✖ DATABASE_URL points at the local database. Set it to the online session pooler (.env section 9).");
  process.exit(1);
}

// 1. Password
let password = env.get("STAGING_TEST_PASSWORD") ?? "";
if (!password) {
  password = generatePassword();
  const envPath = resolve(root, ".env");
  writeFileSync(envPath, setEnvValues(readFileSync(envPath, "utf8"), new Map([["STAGING_TEST_PASSWORD", password]])));
  console.log("✔ .env: STAGING_TEST_PASSWORD generated");
}

// 2. Logins
const serviceKey = await apiKey("service_role");
async function authAdmin<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${url}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Auth API ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

const { users: existing } = await authAdmin<{ users: { id: string; email: string }[] }>("/users?per_page=1000");
const ids = new Map<string, string>();
for (const u of USERS) {
  const found = existing.find((e) => e.email?.toLowerCase() === u.email);
  if (found) {
    await authAdmin(`/users/${found.id}`, "PUT", { password, email_confirm: true });
    ids.set(u.email, found.id);
    console.log(`• login ${u.username}: already there, password refreshed`);
  } else {
    const created = await authAdmin<{ id: string }>("/users", "POST", { email: u.email, password, email_confirm: true });
    ids.set(u.email, created.id);
    console.log(`✔ login ${u.username}: created`);
  }
}

// 3 + 4. Staff rows and demo settings, in one transaction
const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
try {
  await db.query("begin");
  for (const u of USERS) {
    await db.query(
      `insert into public.staff (id, role, full_name, username, phone_e164)
       values ($1, $2::public.staff_role, $3, $4, $5)
       on conflict (id) do update
         set role = excluded.role, full_name = excluded.full_name, username = excluded.username,
             phone_e164 = excluded.phone_e164, active = true, deactivated_at = null`,
      [ids.get(u.email), u.role, u.fullName, u.username, u.phone],
    );
  }
  console.log(`✔ staff rows: ${USERS.length} (one per role)`);

  await db.query(readFileSync(resolve(root, "supabase/seed/02_demo_settings.sql"), "utf8"));
  console.log("✔ demo clinic, doctors, libraries and settings present (existing rows left as they are)");
  await db.query("commit");
} catch (e) {
  await db.query("rollback");
  throw e;
} finally {
  await db.end();
}

console.log("\n✔ Staging is ready. Log in with any username above; the password is STAGING_TEST_PASSWORD in .env.");
