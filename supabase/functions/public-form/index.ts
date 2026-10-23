import { fail, handler, json, readJson } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { publicForm } from "./logic.ts";

const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
const db = serviceClient();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(handler(async (req) => {
  // No bot-check secret = refuse loudly instead of silently letting bots through.
  if (!turnstileSecret) return fail("not_configured", 503, "TURNSTILE_SECRET_KEY is not set");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const result = await publicForm(await readJson(req), ip, {
    rpc: async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
    async verifyTurnstile(token, remoteIp) {
      const form = new FormData();
      form.append("secret", turnstileSecret);
      form.append("response", token);
      if (remoteIp) form.append("remoteip", remoteIp);
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean };
      return body.success === true;
    },
    // Salted with the secret so the stored hash can't be reversed by trying all IPs.
    hashIp: (value) => sha256Hex(`${turnstileSecret}:${value}`),
  });
  return json(result.body, result.status);
}));
