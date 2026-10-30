import { postMessages } from "../_shared/meta.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { classifyError, dispatch, type Deps as SendDeps } from "../wa-dispatch/logic.ts";
import { replyNow, webhook, type Deps } from "./logic.ts";

const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";
const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const keys = { token, phoneNumberId, appSecret };
const db = serviceClient();

// Supabase's runtime keeps the function alive for work started after the response.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const deps: Deps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
};

const sendDeps: SendDeps = {
  rpc: deps.rpc,
  async send(body) {
    const r = await postMessages(body, keys);
    if (r.error !== undefined) return { ok: false, ...classifyError(0, { message: r.error }) };
    const id = (r.json.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (r.status >= 200 && r.status < 300 && typeof id === "string") return { ok: true, id };
    return { ok: false, ...classifyError(r.status, r.json.error as Parameters<typeof classifyError>[1]) };
  },
};

function answerNow(ids: string[]): Promise<void> {
  return replyNow(ids, {
    markReadTyping: async (id) => {
      const r = await postMessages({ messaging_product: "whatsapp", status: "read", message_id: id, typing_indicator: { type: "text" } }, keys);
      if (r.status !== 200) console.error("typing indicator", r.status, r.error ?? JSON.stringify(r.json.error ?? {}));
    },
    flush: async () => void (await dispatch({ source: "bot", configured: !!(token && phoneNumberId) }, sendDeps)),
  }).catch((e) => console.error("bot reply", e));
}

// Called by Meta only (no browser), so no CORS.
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const raw = new Uint8Array(await req.arrayBuffer());
    const res = await webhook(
      { method: req.method, params: url.searchParams, signature: req.headers.get("X-Hub-Signature-256"), raw },
      { appSecret, verifyToken },
      deps,
    );
    // The bot's replies go after Meta has its 200 (Meta waits for nothing slow).
    if ("replyTo" in res && res.replyTo?.length) {
      const job = answerNow(res.replyTo);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job);
      else await job;
    }
    return "text" in res
      ? new Response(res.text, { status: res.status, headers: { "Content-Type": "text/plain" } })
      : Response.json(res.json, { status: res.status });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "unknown" }, { status: 500 });
  }
});
