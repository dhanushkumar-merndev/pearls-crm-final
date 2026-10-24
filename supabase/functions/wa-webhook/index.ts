import { serviceClient } from "../_shared/supabase.ts";
import { webhook, type Deps } from "./logic.ts";

const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";
const db = serviceClient();

const deps: Deps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
};

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
    return "text" in res
      ? new Response(res.text, { status: res.status, headers: { "Content-Type": "text/plain" } })
      : Response.json(res.json, { status: res.status });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "unknown" }, { status: 500 });
  }
});
