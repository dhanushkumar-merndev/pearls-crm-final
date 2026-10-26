import { fail, handler, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { cronOk } from "../wa-dispatch/logic.ts";
import { orsProvider, run, type Deps } from "./logic.ts";

const cronSecret = Deno.env.get("EDGE_CRON_SECRET") ?? "";
const orsKey = Deno.env.get("ORS_API_KEY") ?? "";
const db = serviceClient();

const deps: Deps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  },
  routing: orsKey ? orsProvider(orsKey) : null,
};

Deno.serve(handler(async (req) => {
  // Only the database timer calls this.
  if (!cronOk(req.headers.get("x-cron-secret"), cronSecret)) return fail("not_allowed", 403);
  return json(await run(deps));
}));
