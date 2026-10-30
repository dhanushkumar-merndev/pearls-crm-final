// Meta (Facebook / Instagram / WhatsApp) basics shared by meta-leads and the wa-* functions:
// webhook signatures, the subscription check and Graph API addresses.

export const GRAPH_VERSION = "v23.0";

export async function hmacHex(key: string, data: Uint8Array | string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const sig = await crypto.subtle.sign("HMAC", k, bytes as BufferSource);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two texts in constant time (no early exit that leaks how much matched). */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret), compared in constant time. */
export async function signatureOk(raw: Uint8Array, header: string | null, appSecret: string): Promise<boolean> {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  return sameText(header.slice("sha256=".length).toLowerCase(), await hmacHex(appSecret, raw));
}

/** Meta's webhook subscription check: echo hub.challenge when the verify token matches. */
export function challenge(params: URLSearchParams, verifyToken: string): { status: number; body: string } {
  if (verifyToken && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === verifyToken) {
    return { status: 200, body: params.get("hub.challenge") ?? "" };
  }
  return { status: 403, body: "forbidden" };
}

/**
 * A Graph API address. With the app secret, appsecret_proof is added: Meta then accepts the
 * token only from someone who also knows the secret (required when the app has
 * "Require app secret" switched on, harmless otherwise).
 */
export async function graphUrl(path: string, token: string, appSecret: string, params: Record<string, string> = {}): Promise<URL> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (appSecret && token) url.searchParams.set("appsecret_proof", await hmacHex(appSecret, token));
  return url;
}

/** POST {phone-number-id}/messages (a message, or a read receipt + typing indicator). Never throws. */
export async function postMessages(
  body: Record<string, unknown>,
  keys: { token: string; phoneNumberId: string; appSecret: string },
): Promise<{ status: number; json: Record<string, unknown>; error?: string }> {
  try {
    const res = await fetch(await graphUrl(`${keys.phoneNumberId}/messages`, keys.token, keys.appSecret), {
      method: "POST",
      headers: { Authorization: `Bearer ${keys.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch (e) {
    return { status: 0, json: {}, error: (e as Error).message };
  }
}
