import { fail, handler, json, readJson } from "../_shared/http.ts";
import { postMessages } from "../_shared/meta.ts";
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
    const r = await postMessages(body, { token, phoneNumberId, appSecret });
    if (r.error !== undefined) return { ok: false, ...classifyError(0, { message: r.error }) };
    const id = (r.json.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (r.status >= 200 && r.status < 300 && typeof id === "string") return { ok: true, id };
    return { ok: false, ...classifyError(r.status, r.json.error as Parameters<typeof classifyError>[1]) };
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
  // Reminders and drips only on the timer, never because someone clicked or the bot replied.
  const source = cron ? (parsed.data.source === "bot" ? "bot" : "cron") : "staff";
  return json(await dispatch({ source, configured: !!(token && phoneNumberId) }, deps));
}));
