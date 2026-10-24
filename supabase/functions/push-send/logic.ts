// push-send: delivers one notification to the recipient's Android phones with Firebase Cloud
// Messaging (HTTP v1). Called by Postgres (trigger on public.notifications → pg_net, header
// x-cron-secret) right after the notification is saved. Best effort: the notification is
// already in the app's bell; push only makes the phone ring. Tokens Firebase no longer knows
// are removed. Pure logic here; index.ts wires the real Firebase and database.
import { z } from "zod";

export const pushSchema = z.object({ id: z.uuid() }).strict();

export const serviceAccountSchema = z.object({
  client_email: z.string().min(3),
  private_key: z.string().includes("PRIVATE KEY"),
  project_id: z.string().min(1).optional(),
  token_uri: z.url().optional(),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

export const payloadSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string().default(""),
  link: z.string().nullable().optional(),
  read: z.boolean().default(false),
  tokens: z.array(z.string()).default([]),
});
export type Payload = z.infer<typeof payloadSchema>;

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (text: string) => b64url(new TextEncoder().encode(text));

/** PEM "-----BEGIN PRIVATE KEY-----…" → the PKCS#8 bytes. Accepts "\n" written as two characters. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/\\n/g, "\n").replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** The signed assertion Google trades for an access token (RFC 7523, RS256, 1 hour). */
export async function signedAssertion(sa: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: sa.token_uri ?? GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
}

/** One FCM v1 message. Data only, so the app always shows it itself (its channel, its icon). */
export function fcmMessage(token: string, p: Payload): Record<string, unknown> {
  return {
    message: {
      token,
      data: { id: p.id, type: p.type, title: p.title.slice(0, 200), body: p.body.slice(0, 1000), link: p.link ?? "" },
      android: { priority: "HIGH", ttl: "86400s" },
    },
  };
}

export type SendOutcome = "sent" | "gone" | "auth" | "failed";

/** Firebase's answer → what to do. https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode */
export function classify(status: number, body: unknown): SendOutcome {
  if (status >= 200 && status < 300) return "sent";
  const err = (body as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null)?.error;
  const codes = [err?.status, ...(err?.details ?? []).map((d) => d.errorCode)];
  if (codes.includes("UNREGISTERED") || status === 404) return "gone";
  if (codes.includes("INVALID_ARGUMENT") && /registration token/i.test(err?.message ?? "")) return "gone";
  if (status === 401 || status === 403 || codes.includes("SENDER_ID_MISMATCH") || codes.includes("THIRD_PARTY_AUTH_ERROR")) return "auth";
  return "failed";
}

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** Sends one message; returns Firebase's HTTP status and body. */
  send: (message: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
}

export interface Result {
  state: "off" | "skipped" | "done" | "auth_error";
  sent: number;
  dropped: number;
  failed: number;
}

/** Sends notification [id] to every Android phone of its recipient. */
export async function run(id: string, configured: boolean, deps: Deps): Promise<Result> {
  const result: Result = { state: "done", sent: 0, dropped: 0, failed: 0 };
  if (!configured) return { ...result, state: "off" };
  const { data, error } = await deps.rpc("push_payload", { p_id: id });
  if (error) throw new Error(error.message);
  const parsed = payloadSchema.safeParse(data);
  // Deleted already, read already, or no phone: nothing to ring.
  if (!parsed.success || parsed.data.read || parsed.data.tokens.length === 0) return { ...result, state: "skipped" };
  const gone: string[] = [];
  for (const token of parsed.data.tokens.slice(0, 10)) {
    let outcome: SendOutcome;
    try {
      const res = await deps.send(fcmMessage(token, parsed.data));
      outcome = classify(res.status, res.body);
    } catch {
      outcome = "failed";
    }
    if (outcome === "sent") result.sent++;
    else if (outcome === "gone") gone.push(token);
    else if (outcome === "auth") {
      // Wrong key or project: every phone would fail the same way.
      result.state = "auth_error";
      result.failed++;
      break;
    } else result.failed++;
  }
  if (gone.length) {
    await deps.rpc("push_tokens_drop", { p_tokens: gone });
    result.dropped = gone.length;
  }
  await deps.rpc("push_log_run", { p_ok: result.state === "done" && result.failed === 0, p_detail: { id, ...result } });
  return result;
}
