import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = Deno.env.get("SUPABASE_URL")!;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/**
 * Acts AS the caller: every query and RPC runs under their login, so RLS and the
 * role checks inside RPCs apply exactly as they do for the apps.
 */
export function callerClient(req: Request): SupabaseClient | null {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return createClient(url, publicKey, {
    ...noSession,
    global: { headers: { Authorization: authorization } },
  });
}

/** Full-access client. Only for Auth admin calls that have no RPC equivalent. */
export function serviceClient(): SupabaseClient {
  return createClient(url, secretKey, noSession);
}
