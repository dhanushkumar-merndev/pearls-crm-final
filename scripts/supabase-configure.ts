/**
 * Applies login settings and Edge Function secrets to the online Supabase project
 * from the root .env (pnpm supabase:configure). Run after the first deploy and
 * whenever WEB_ORIGIN, SMTP_* or an integration key changes. Values are never printed.
 */
import { FUNCTION_KEYS } from "./env-sync.ts";
import { project, webOrigins } from "./supabase-api.ts";

const { env, api } = project();
const { site, all } = webOrigins(env);

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
