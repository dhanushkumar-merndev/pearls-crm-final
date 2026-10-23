// Shared HTTP helpers for Edge Functions. Errors use the same stable codes as RPCs
// (packages/shared/src/errors.ts) so the apps translate them the same way.

// WEB_ORIGIN: comma-separated web app addresses allowed to call from a browser
// (e.g. "http://localhost:3000,https://pearl-crm.vercel.app"). Unset = any.
const allowedOrigins = (Deno.env.get("WEB_ORIGIN") ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

/** The Access-Control-Allow-Origin value for this caller, or null to leave it out. */
export function allowOrigin(origin: string | null, allowed: string[] = allowedOrigins): string | null {
  if (allowed.includes("*")) return "*";
  return origin && allowed.includes(origin) ? origin : null;
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
