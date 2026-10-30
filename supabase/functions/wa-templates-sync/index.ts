import { fail, handler, json, readJson } from "../_shared/http.ts";
import { graphUrl } from "../_shared/meta.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";
import { GraphError, run, syncSchema, type Deps, type GraphTemplate, type PhoneInfo } from "./logic.ts";

const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const wabaId = Deno.env.get("WHATSAPP_WABA_ID") ?? "";
const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const db = serviceClient();

async function graph<T>(url: URL, body?: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new GraphError(`Meta did not answer: ${(e as Error).message}`);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (out as { error?: { message?: string; error_user_msg?: string } }).error;
    throw new GraphError(e?.error_user_msg ?? e?.message ?? `Graph API ${res.status}`);
  }
  return out as T;
}

const deps: Deps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  async listTemplates() {
    const out: GraphTemplate[] = [];
    let url: URL | null = await graphUrl(`${wabaId}/message_templates`, token, appSecret, {
      fields: "id,name,language,category,status,components",
      limit: "100",
    });
    // At most 5 pages (500 templates) — far more than a clinic has.
    for (let page = 0; url && page < 5; page++) {
      const body: { data?: GraphTemplate[]; paging?: { next?: string } } = await graph(url);
      out.push(...(body.data ?? []));
      url = body.paging?.next?.startsWith("https://graph.facebook.com/") ? new URL(body.paging.next) : null;
    }
    return out;
  },
  async createFlow(name, flowJson) {
    const out = await graph<{ id?: string; validation_errors?: { message?: string; error?: string }[] }>(
      await graphUrl(`${wabaId}/flows`, token, appSecret),
      { name, categories: ["LEAD_GENERATION"], flow_json: flowJson },
    );
    const problem = out.validation_errors?.[0];
    if (problem) throw new GraphError(problem.message ?? problem.error ?? "Meta did not accept the form");
    return String(out.id ?? "");
  },
  async publishFlow(id) {
    await graph(await graphUrl(`${id}/publish`, token, appSecret), {});
  },
  async phoneInfo() {
    return await graph<PhoneInfo>(await graphUrl(phoneNumberId, token, appSecret, {
      fields: "display_phone_number,verified_name,quality_rating",
    }));
  },
};

Deno.serve(handler(async (req) => {
  const caller = await callerClient(req);
  if (!caller) return fail("not_signed_in", 401);
  const { data: me, error } = await caller.rpc("me");
  if (error || (me as { role?: string } | null)?.role !== "admin") return fail("not_allowed", 403);
  const parsed = syncSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("invalid_input");
  const res = await run(parsed.data, !!(token && phoneNumberId && wabaId), deps);
  return json(res.body, res.status);
}));
