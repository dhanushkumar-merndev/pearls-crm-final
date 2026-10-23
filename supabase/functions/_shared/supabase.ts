import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = Deno.env.get("SUPABASE_URL")!;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/**
 * Acts AS the caller: every query and RPC runs under their login, so RLS and the
 * role checks inside RPCs apply exactly as they do for the apps.
 * The login token is checked here (getClaims: JWKS for ES256 keys, the Auth server for
 * legacy HS256) because the gateway's verify_jwt only knows the legacy secret, so
 * config.toml turns it off. Returns null for a missing, expired, forged or anon token.
 */
export async function callerClient(req: Request): Promise<SupabaseClient | null> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const db = createClient(url, publicKey, {
    ...noSession,
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await db.auth.getClaims(authorization.slice("Bearer ".length));
  if (error || !data?.claims.sub || data.claims.role !== "authenticated") return null;
  return db;
}

/** Full-access client. Only for Auth admin calls that have no RPC equivalent. */
export function serviceClient(): SupabaseClient {
  return createClient(url, secretKey, noSession);
}
