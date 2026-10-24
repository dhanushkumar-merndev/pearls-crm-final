import { fail, handler, json, readJson } from "../_shared/http.ts";
import { graphUrl } from "../_shared/meta.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";
import { classifyError, cronOk, dispatch, dispatchSchema, type Deps } from "./logic.ts";

const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const cronSecret = Deno.env.get("EDGE_CRON_SECRET") ?? "";
const db = serviceClient();

const deps: Deps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  async send(body) {
    try {
      const res = await fetch(await graphUrl(`${phoneNumberId}/messages`, token, appSecret), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const out = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: Parameters<typeof classifyError>[1] };
      const id = out.messages?.[0]?.id;
      if (res.ok && typeof id === "string") return { ok: true, id };
      return { ok: false, ...classifyError(res.status, out.error) };
    } catch (e) {
      return { ok: false, ...classifyError(0, { message: (e as Error).message }) };
    }
  },
};

Deno.serve(handler(async (req) => {
  const cron = cronOk(req.headers.get("x-cron-secret"), cronSecret);
  if (!cron) {
    // A staff member's send from the web app: any active staff login may flush the queue.
    const caller = await callerClient(req);
    if (!caller) return fail("not_signed_in", 401);
    const { error } = await caller.rpc("me");
    if (error) return fail("not_allowed", 403);
  }
  const parsed = dispatchSchema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return fail("invalid_input");
  // Reminders and drips only on the timer, never because someone clicked.
  return json(await dispatch({ source: cron ? "cron" : "staff", configured: !!(token && phoneNumberId) }, deps));
}));
