import { fail, handler, json, readJson } from "../_shared/http.ts";
import { graphUrl } from "../_shared/meta.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";
import { cronOk } from "../wa-dispatch/logic.ts";
import { GraphError, sync, syncSchema, type Deps } from "./logic.ts";

// The clinic's Meta system-user key (ads_read) and its app secret, as for meta-leads.
const token = Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "";
const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
const cronSecret = Deno.env.get("EDGE_CRON_SECRET") ?? "";
const db = serviceClient();

const deps: Deps = {
  async graph(pathOrUrl, params) {
    // Meta's own `next` paging links are followed as they are; nothing else leaves graph.facebook.com.
    const url = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl) : await graphUrl(pathOrUrl, token, appSecret, params ?? {});
    if (url.hostname !== "graph.facebook.com") throw new GraphError("unexpected paging link", null);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
    if (!res.ok || body.error) throw new GraphError((body.error?.message ?? `Meta returned ${res.status}`).slice(0, 300), body.error?.code ?? null);
    return body;
  },
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  today(timezone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: timezone ?? "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    } catch {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    }
  },
};

Deno.serve(handler(async (req) => {
  const cron = cronOk(req.headers.get("x-cron-secret"), cronSecret);
  if (!cron) {
    // "Sync now" on the Ads page: sales managers and admins, at most once a minute.
    const caller = await callerClient(req);
    if (!caller) return fail("not_signed_in", 401);
    const { data, error } = await caller.rpc("ads_sync_request");
    if (error) return fail("not_allowed", 403);
    if (data !== true) return json({ ok: false, error: "too_soon" });
  }
  const parsed = syncSchema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return fail("invalid_input");
  if (!token || !appSecret) return json({ ok: false, error: "not_configured" });
  return json(await sync({ backfill: cron }, deps));
}));
