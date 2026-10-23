// Shared HTTP helpers for Edge Functions. Errors use the same stable codes as RPCs
// (packages/shared/src/errors.ts) so the apps translate them the same way.

const allowedOrigin = Deno.env.get("WEB_ORIGIN") ?? "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

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

/** Wraps a handler with CORS preflight, POST-only and a crash guard. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return fail("method_not_allowed", 405);
    try {
      return await fn(req);
    } catch (e) {
      console.error(e);
      return fail("unknown", 500);
    }
  };
}
