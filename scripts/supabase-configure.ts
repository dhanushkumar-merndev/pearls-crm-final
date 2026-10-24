/**
 * Applies login settings and Edge Function secrets to the online Supabase project
 * from the root .env (pnpm supabase:configure). Run after the first deploy and
 * whenever WEB_ORIGIN, SMTP_* or an integration key changes. Values are never printed.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { setEnvValues } from "./env-set.ts";
import { FUNCTION_KEYS } from "./env-sync.ts";
import { project, root, webOrigins } from "./supabase-api.ts";

const { env, api, url } = project();
const { site, all } = webOrigins(env);

// The database timer (pg_cron → pg_net) proves itself to wa-dispatch with this secret.
let cronSecret = env.get("EDGE_CRON_SECRET") ?? "";
if (!cronSecret) {
  cronSecret = randomBytes(32).toString("hex");
  env.set("EDGE_CRON_SECRET", cronSecret);
  const envPath = resolve(root, ".env");
  writeFileSync(envPath, setEnvValues(readFileSync(envPath, "utf8"), new Map([["EDGE_CRON_SECRET", cronSecret]])));
  console.log("✔ .env: EDGE_CRON_SECRET made (64 characters)");
}

// Mirrors supabase/config.toml [auth] so local and online behave the same.
const auth: Record<string, unknown> = {
  site_url: site,
  uri_allow_list: all.map((o) => `${o}/**`).join(","),
  disable_signup: true,
  external_anonymous_users_enabled: false,
  password_min_length: 8,
  password_required_characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
  mailer_secure_email_change_enabled: true,
  refresh_token_rotation_enabled: true,
  security_refresh_token_reuse_interval: 10,
  jwt_exp: 3600,
  hook_custom_access_token_enabled: true,
  hook_custom_access_token_uri: "pg-functions://postgres/public/custom_access_token_hook",
};
if (env.get("SMTP_USER") && env.get("SMTP_PASS")) {
  Object.assign(auth, {
    smtp_host: env.get("SMTP_HOST"),
    smtp_port: env.get("SMTP_PORT"),
    smtp_user: env.get("SMTP_USER"),
    smtp_pass: env.get("SMTP_PASS"),
    smtp_admin_email: env.get("SMTP_SENDER_EMAIL"),
    smtp_sender_name: env.get("SMTP_SENDER_NAME"),
    rate_limit_email_sent: 30,
  });
}
await api("/config/auth", { method: "PATCH", body: auth });
console.log(`✔ Login settings: sign-up off, passwords 8+ with letters and digits, role hook on`);
console.log(`  web app: ${site} · allowed: ${all.join(", ")}`);
console.log(env.get("SMTP_USER") ? "✔ Emails go through Brevo" : "• Emails use Supabase's built-in sender (fill .env section 4 for Brevo)");

const secrets = FUNCTION_KEYS.filter((k) => env.get(k)).map((name) => ({ name, value: env.get(name)! }));
if (secrets.length) await api("/secrets", { method: "POST", body: secrets });
console.log(`✔ Server function keys: ${secrets.length} of ${FUNCTION_KEYS.length} set (${secrets.map((s) => s.name).join(", ")})`);

// The same secret and the functions' address go into the database's Vault, where
// private.call_edge reads them. Only for the online database (DATABASE_URL in section 9).
const databaseUrl = env.get("DATABASE_URL") ?? "";
if (databaseUrl && !/@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl)) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    for (const [name, value] of [["edge_base_url", `${url}/functions/v1`], ["edge_cron_secret", cronSecret]] as const) {
      const { rows } = await db.query<{ id: string }>("select id from vault.secrets where name = $1", [name]);
      if (rows[0]) await db.query("select vault.update_secret($1, $2)", [rows[0].id, value]);
      else await db.query("select vault.create_secret($1, $2)", [value, name]);
    }
  } finally {
    await db.end();
  }
  console.log("✔ Database timer can start server functions (Vault: edge_base_url, edge_cron_secret)");
} else {
  console.log("• DATABASE_URL is not the online database: timer secrets not stored (fill .env section 9)");
}
