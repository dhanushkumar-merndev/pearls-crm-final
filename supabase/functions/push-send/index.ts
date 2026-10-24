import { fail, handler, json, readJson } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { cronOk } from "../wa-dispatch/logic.ts";
import { GOOGLE_TOKEN_URL, pushSchema, run, serviceAccountSchema, signedAssertion, type Deps, type ServiceAccount } from "./logic.ts";

const cronSecret = Deno.env.get("EDGE_CRON_SECRET") ?? "";
const account: ServiceAccount | null = (() => {
  try {
    const parsed = serviceAccountSchema.safeParse(JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? ""));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
})();
const projectId = Deno.env.get("FCM_PROJECT_ID") || account?.project_id || "";
const db = serviceClient();

// Google access tokens last an hour; keep one per warm instance.
let cached: { token: string; until: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.until > now + 60) return cached.token;
  const res = await fetch(sa.token_uri ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await signedAssertion(sa, now),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const out = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !out.access_token) throw new Error(`google token: HTTP ${res.status}`);
  cached = { token: out.access_token, until: now + (out.expires_in ?? 3600) };
  return out.access_token;
}

const deps: Deps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  async send(message) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(account!)}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
};

Deno.serve(handler(async (req) => {
  // Only the database calls this (after a notification is saved).
  if (!cronOk(req.headers.get("x-cron-secret"), cronSecret)) return fail("not_allowed", 403);
  const parsed = pushSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("invalid_input");
  return json(await run(parsed.data.id, !!(account && projectId), deps));
}));
