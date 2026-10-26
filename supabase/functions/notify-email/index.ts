import { sendMail, siteBase } from "../_shared/email.ts";
import { fail, handler, json, readJson } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { cronOk } from "../wa-dispatch/logic.ts";
import { notifySchema, run, type Deps } from "./logic.ts";

const cronSecret = Deno.env.get("EDGE_CRON_SECRET") ?? "";
const apiKey = Deno.env.get("BREVO_API_KEY") ?? "";
const sender = { email: Deno.env.get("SMTP_SENDER_EMAIL") ?? "", name: Deno.env.get("SMTP_SENDER_NAME") || "Clinic CRM" };
const db = serviceClient();

const deps: Deps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  send: (mail) =>
    sendMail(apiKey, sender, mail, async (url, init) => {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      return { status: res.status, body: await res.json().catch(() => null) };
    }),
  base: siteBase(Deno.env.get("WEB_ORIGIN") ?? ""),
};

Deno.serve(handler(async (req) => {
  // Only the database calls this (after a notification is saved).
  if (!cronOk(req.headers.get("x-cron-secret"), cronSecret)) return fail("not_allowed", 403);
  const parsed = notifySchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("invalid_input");
  return json(await run(parsed.data.id, !!(apiKey && sender.email), deps));
}));
