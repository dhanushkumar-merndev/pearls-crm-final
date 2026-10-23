/**
 * Small helpers for the online Supabase project, shared by the deploy/setup scripts.
 * Uses the Management API with SUPABASE_ACCESS_TOKEN. Never prints keys.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env-sync.ts";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function need(env: Map<string, string>, ...keys: string[]): string[] {
  const missing = keys.filter((k) => !env.get(k));
  if (missing.length) {
    console.error(`✖ Missing in .env (section 9): ${missing.join(", ")}`);
    process.exit(1);
  }
  return keys.map((k) => env.get(k)!);
}

export function project() {
  const env = loadEnv();
  const [token, ref] = need(env, "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF");
  async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase API ${init.method ?? "GET"} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  async function apiKey(kind: "publishable" | "service_role"): Promise<string> {
    const keys = await api<{ name: string; type: string; api_key: string }[]>("/api-keys?reveal=true");
    const key = kind === "publishable"
      ? keys.find((k) => k.type === "publishable")
      : keys.find((k) => k.type === "legacy" && k.name === "service_role");
    if (!key?.api_key) throw new Error(`No ${kind} key found on the project`);
    return key.api_key;
  }
  return { env, token, ref, url: `https://${ref}.supabase.co`, api, apiKey };
}

/** Runs the Supabase CLI from node_modules with the project's token in its environment. */
export function supabaseCli(args: string[], extraEnv: Record<string, string> = {}) {
  const { env, token } = project();
  console.log(`\n▶ supabase ${args.join(" ")}`);
  const result = spawnSync(resolve(root, "node_modules/.bin/supabase"), args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: token,
      SUPABASE_DB_PASSWORD: env.get("SUPABASE_DB_PASSWORD") ?? "",
      ...extraEnv,
    },
  });
  if (result.status !== 0) {
    console.error(`✖ supabase ${args[0]} failed`);
    process.exit(result.status ?? 1);
  }
}

/** First https address in WEB_ORIGIN is the online web app; all of them may log in. */
export function webOrigins(env: Map<string, string>): { site: string; all: string[] } {
  const all = (env.get("WEB_ORIGIN") ?? "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean);
  return { site: all.find((o) => o.startsWith("https://")) ?? all[0]!, all };
}
