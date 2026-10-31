// Shared HTTP helpers for Edge Functions. Errors use the same stable codes as RPCs
// (packages/shared/src/errors.ts) so the apps translate them the same way.

// WEB_ORIGIN: comma-separated web app addresses allowed to call from a browser
// (e.g. "http://localhost:3000,https://pearl-sales.vercel.app"). Unset = any.
const allowedOrigins = (Deno.env.get("WEB_ORIGIN") ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

// This PC (any port) or another device on the same Wi-Fi: the dev server's "Local" and "Network" addresses.
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
// A Vercel preview of a listed site: https://pearl-sales.vercel.app → https://pearl-sales-<anything>.vercel.app.
const vercelPreview = (origin: string, site: string) => {
  const m = /^https:\/\/([a-z0-9-]+)\.vercel\.app$/.exec(site);
  return !!m && origin.startsWith(`https://${m[1]}-`) && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
};

/**
 * The Access-Control-Allow-Origin value for this caller, or null to leave it out. Besides the listed
 * addresses: any local one when a local one is listed, and the listed Vercel site's previews
 * (31/10/2026: the app opened at 127.0.0.1:3000 could not reach any function, so Sync now and
 * WhatsApp's send-now failed). The functions check the login token themselves; this only lets
 * a browser read the answer.
 */
export function allowOrigin(origin: string | null, allowed: string[] = allowedOrigins): string | null {
  if (allowed.includes("*")) return "*";
  if (!origin) return null;
  if (allowed.includes(origin)) return origin;
  if (LOCAL.test(origin) && allowed.some((o) => LOCAL.test(o))) return origin;
  return allowed.some((site) => vercelPreview(origin, site)) ? origin : null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function fail(code: string, status = 400, detail?: string): Response {
  return json({ error: code, ...(detail ? { detail } : {}) }, status);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Wraps a handler with CORS (preflight + allowed origin), POST-only and a crash guard. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const res = await route(req, fn);
    const origin = allowOrigin(req.headers.get("Origin"));
    if (origin) res.headers.set("Access-Control-Allow-Origin", origin);
    return res;
  };
}

async function route(req: Request, fn: (req: Request) => Promise<Response>): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  try {
    return await fn(req);
  } catch (e) {
    console.error(e);
    return fail("unknown", 500);
  }
}
