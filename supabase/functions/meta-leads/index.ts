import { allowOrigin, corsHeaders } from "../_shared/http.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";
import { GRAPH_FIELDS, GRAPH_VERSION, hmacHex, processLeadgen, webhook, type Deps, type GraphLead } from "./logic.ts";

const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
const pageToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "";
const verifyToken = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";
const db = serviceClient();

const deps: Deps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  // appsecret_proof: Meta accepts the page token only together with proof of the app secret.
  async fetchLead(leadgenId): Promise<GraphLead> {
    if (!pageToken) throw new Error("META_PAGE_ACCESS_TOKEN is not set");
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}`);
    url.searchParams.set("fields", GRAPH_FIELDS);
    url.searchParams.set("access_token", pageToken);
    url.searchParams.set("appsecret_proof", await hmacHex(appSecret, pageToken));
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `Graph API ${res.status}`);
    return body as GraphLead;
  },
  async fieldMap() {
    const { data } = await db.from("app_settings").select("value").eq("section", "sales").maybeSingle();
    return ((data?.value as { meta_field_map?: Record<string, string> } | undefined)?.meta_field_map) ?? {};
  },
};

function reply(status: number, body: unknown, origin: string | null, text = false): Response {
  const headers: Record<string, string> = { ...corsHeaders, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  headers["Content-Type"] = text ? "text/plain" : "application/json";
  return new Response(text ? String(body) : JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const origin = allowOrigin(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return reply(200, "ok", origin, true);
  try {
    // An admin retrying a failed lead from the web app (login token, no Meta signature).
    if (req.method === "POST" && !req.headers.get("X-Hub-Signature-256") && req.headers.get("Authorization")) {
      const caller = await callerClient(req);
      if (!caller) return reply(401, { error: "not_signed_in" }, origin);
      const body = (await req.json().catch(() => null)) as { action?: string; leadgen_id?: string } | null;
      if (body?.action !== "retry" || typeof body.leadgen_id !== "string") return reply(400, { error: "invalid_input" }, origin);
      const { data: allowed, error } = await caller.rpc("meta_lead_retry_check", { p_leadgen_id: body.leadgen_id });
      if (error) return reply(403, { error: "not_allowed" }, origin);
      if (!allowed) return reply(409, { error: "stale_version" }, origin);
      return reply(200, await processLeadgen({ leadgen_id: body.leadgen_id }, deps), origin);
    }
    const url = new URL(req.url);
    const raw = new Uint8Array(await req.arrayBuffer());
    const res = await webhook(
      { method: req.method, params: url.searchParams, signature: req.headers.get("X-Hub-Signature-256"), raw },
      { appSecret, verifyToken },
      deps,
    );
    return "text" in res ? reply(res.status, res.text, null, true) : reply(res.status, res.json, null);
  } catch (e) {
    console.error(e);
    return reply(500, { error: "unknown" }, origin);
  }
});
