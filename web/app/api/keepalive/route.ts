import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Vercel Cron calls this once a day (web/vercel.json) so a Free-plan Supabase
 * project never pauses for inactivity. It runs one tiny database query.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { error } = await supabase.rpc("public_branding");
  return Response.json({ ok: !error, at: new Date().toISOString() }, { status: error ? 502 : 200 });
}
