import { allowOrigin, corsHeaders } from "../_shared/http.ts";
import { graphUrl } from "../_shared/meta.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";
import { type AdminDeps, adminSchema, check, connect, importLeads } from "./admin.ts";
import { GRAPH_FIELDS, processLeadgen, webhook, type Deps, type GraphLead } from "./logic.ts";

const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
const pageToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "";
const verifyToken = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";
const pageId = Deno.env.get("META_PAGE_ID") ?? "";
const appId = Deno.env.get("META_APP_ID") ?? "";
const db = serviceClient();

type Params = Record<string, string>;

/** One Graph API call with the given key (appsecret_proof added). Meta's `next` links are followed as they are. */
async function graph(pathOrUrl: string, key: string, params?: Params, method = "GET"): Promise<Record<string, unknown>> {
  const url = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl) : await graphUrl(pathOrUrl, key, appSecret, params ?? {});
  if (url.hostname !== "graph.facebook.com") throw new Error("unexpected paging link");
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok || body.error) throw new Error((body.error?.message ?? `Graph API ${res.status}`).slice(0, 300));
  return body;
}

// The saved key is a system-user key; reading a lead wants the Page's own key, which it can fetch.
// Kept for 30 minutes per warm instance; when the page can't be asked, the saved key is tried as it is.
let pageKeyCache: { key: string; until: number } | null = null;
async function leadKey(): Promise<string> {
  if (pageKeyCache && pageKeyCache.until > Date.now()) return pageKeyCache.key;
  if (!pageId) return pageToken;
  try {
    const p = await graph(pageId, pageToken, { fields: "access_token" });
    if (typeof p.access_token !== "string") return pageToken;
    pageKeyCache = { key: p.access_token, until: Date.now() + 30 * 60_000 };
    return p.access_token;
  } catch {
    return pageToken;
  }
}

async function fieldMap(): Promise<Record<string, string>> {
  const { data } = await db.from("app_settings").select("value").eq("section", "sales").maybeSingle();
  return ((data?.value as { meta_field_map?: Record<string, string> } | undefined)?.meta_field_map) ?? {};
}

const rpc: Deps["rpc"] = async (fn, args) => {
  const { data, error } = await db.rpc(fn, args);
  return { data, error: error ? { message: error.message } : null };
};

const deps: Deps = {
  rpc,
  async fetchLead(leadgenId): Promise<GraphLead> {
    if (!pageToken) throw new Error("META_PAGE_ACCESS_TOKEN is not set");
    return (await graph(encodeURIComponent(leadgenId), await leadKey(), { fields: GRAPH_FIELDS })) as GraphLead;
  },
  fieldMap,
};

const adminDeps: AdminDeps = {
  graph: (pathOrUrl, key, params) => graph(pathOrUrl, key, params),
  post: (path, key, params) => graph(path, key, params, "POST"),
  rpc,
  fieldMap,
  systemKey: pageToken,
  pageId,
  appId,
  now: Date.now,
};

// "Import past leads" stops here and reports done:false; the page runs it again (the function limit is 150 s).
const IMPORT_BUDGET_MS = 100_000;

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
    // Staff from the web app (login token, no Meta signature): retry, check, connect, import.
    if (req.method === "POST" && !req.headers.get("X-Hub-Signature-256") && req.headers.get("Authorization")) {
      const started = Date.now();
      const caller = await callerClient(req);
      if (!caller) return reply(401, { error: "not_signed_in" }, origin);
      const parsed = adminSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return reply(400, { error: "invalid_input" }, origin);
      const body = parsed.data;
      if (body.action === "retry") {
        const { data: allowed, error } = await caller.rpc("meta_lead_retry_check", { p_leadgen_id: body.leadgen_id });
        if (error) return reply(403, { error: "not_allowed" }, origin);
        if (!allowed) return reply(409, { error: "stale_version" }, origin);
        return reply(200, await processLeadgen({ leadgen_id: body.leadgen_id }, deps), origin);
      }
      const { data: allowed, error } = await caller.rpc("meta_lead_import_check");
      if (error || allowed !== true) return reply(403, { error: "not_allowed" }, origin);
      if (!pageToken || !pageId) return reply(200, { ok: false, error: "not_configured" }, origin);
      if (body.action === "check") return reply(200, await check(adminDeps), origin);
      if (body.action === "connect") return reply(200, await connect(adminDeps), origin);
      return reply(200, await importLeads(body.days, started + IMPORT_BUDGET_MS, adminDeps), origin);
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
