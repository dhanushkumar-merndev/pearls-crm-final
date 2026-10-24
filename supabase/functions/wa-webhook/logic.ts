// wa-webhook: the WhatsApp Cloud API webhook (PLAN.md D2).
//   GET  from Meta: the subscription check (hub.verify_token) → hub.challenge.
//   POST from Meta: signed with the app secret (X-Hub-Signature-256).
//        • statuses move our messages up (sent → delivered → read, or failed);
//        • incoming messages are stored and short replies understood: YES / ಹೌದು / हाँ confirm
//          the next booking, NO / change ask for a call back, STOP / START switch messages off/on.
// Every step is safe to repeat (Meta re-sends a delivery until it gets a 200): Postgres ignores
// a status that is not higher and an incoming message id it already has. Each event is logged
// AFTER it was applied, so a database error (500) lets Meta's retry apply it.
// Pure logic here; index.ts wires the real database.
import { z } from "zod";
import { challenge, signatureOk } from "../_shared/meta.ts";

export type ReplyAction = "confirm" | "reschedule" | "stop" | "start";

// Whole words or short phrases, after lower-casing and removing punctuation. Kannada and Hindi
// (Devanagari and typed in English letters) because that is how patients answer.
const PHRASES: Record<ReplyAction, string[]> = {
  stop: [
    "stop", "unsubscribe", "opt out", "optout", "stop messages", "stop all", "stop sending",
    "ನಿಲ್ಲಿಸಿ", "ಬೇಡ ಮೆಸೇಜ್", "बंद", "बंद करो", "बंद करें", "band karo", "band karen",
  ],
  start: ["start", "unstop", "subscribe", "resume", "ಪ್ರಾರಂಭಿಸಿ", "शुरू", "शुरू करो", "shuru"],
  reschedule: [
    "no", "n", "nope", "reschedule", "change", "change time", "change date", "postpone", "cancel", "cant come", "cannot come",
    "not coming", "wont come", "will not come", "another day", "another time", "later",
    "ಇಲ್ಲ", "ಬೇಡ", "ಬರಲ್ಲ", "ಬರುವುದಿಲ್ಲ", "नहीं", "नही", "नहीं आ पाऊंगा", "nahi", "nahin", "nai",
  ],
  confirm: [
    "yes", "y", "yeah", "yea", "yep", "yup", "ya", "ok", "okay", "okk", "k", "kk", "confirm", "confirmed", "sure", "done",
    "will come", "i will come", "coming", "i am coming", "im coming", "see you",
    "ಹೌದು", "ಹೂ", "ಸರಿ", "ಓಕೆ", "ಬರುತ್ತೇನೆ", "हाँ", "हां", "हा", "जी", "जी हाँ", "जी हां", "ठीक है", "आऊंगा", "आऊंगी",
    "haan", "han", "haa", "ha", "ji", "theek hai", "thik hai", "aaunga", "aaungi",
  ],
};
const ORDER: ReplyAction[] = ["stop", "start", "reschedule", "confirm"];
const LOOKUP = new Map<string, ReplyAction>();
for (const action of ORDER) for (const p of PHRASES[action]) if (!LOOKUP.has(p)) LOOKUP.set(p, action);
const LONGEST = Math.max(...[...LOOKUP.keys()].map((p) => p.split(" ").length));
const MAX_WORDS = 6;

/** Lower-case, apostrophes dropped, other punctuation and emoji become spaces (Indic vowel signs kept). */
export function normalizeReply(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What a short reply means, or null when it is unclear (staff read it). Messages over six
 * words are left to staff. STOP always wins (an opt-out must be honoured); otherwise a reply
 * that mixes "yes" and "no" words is unclear.
 */
export function classifyReply(text: string | null | undefined): ReplyAction | null {
  if (!text) return null;
  if (/^\s*(👍|👌|✅|🙏)+\s*$/u.test(text)) return "confirm";
  const words = normalizeReply(text).split(" ").filter(Boolean);
  if (!words.length || words.length > MAX_WORDS) return null;
  const found = new Set<ReplyAction>();
  for (let i = 0; i < words.length;) {
    let step = 1;
    for (let n = Math.min(LONGEST, words.length - i); n >= 1; n--) {
      const action = LOOKUP.get(words.slice(i, i + n).join(" "));
      if (action) {
        found.add(action);
        step = n;
        break;
      }
    }
    i += step;
  }
  if (found.has("stop")) return "stop";
  if (found.has("start")) return "start";
  return found.size === 1 ? [...found][0]! : null;
}

/** Quick-reply buttons send a payload we chose when making the template (CONFIRM, RESCHEDULE, STOP). */
export function classifyButton(payload: string | null | undefined, title: string | null | undefined): ReplyAction | null {
  const p = (payload ?? "").trim().toUpperCase();
  if (["CONFIRM", "YES"].includes(p)) return "confirm";
  if (["RESCHEDULE", "CHANGE", "NO"].includes(p)) return "reschedule";
  if (["STOP", "UNSUBSCRIBE"].includes(p)) return "stop";
  if (p === "START") return "start";
  return classifyReply(title);
}

const unixSeconds = z.string().regex(/^[0-9]{1,12}$/);
const statusSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: unixSeconds.optional(),
  errors: z
    .array(z.object({
      code: z.union([z.number(), z.string()]).optional(),
      title: z.string().optional(),
      message: z.string().optional(),
      error_data: z.object({ details: z.string().optional() }).optional(),
    }))
    .optional(),
});
const caption = z.object({ caption: z.string().optional() }).optional();
const messageSchema = z.object({
  from: z.string().regex(/^[1-9][0-9]{7,14}$/),
  id: z.string().min(1).max(200),
  timestamp: unixSeconds.optional(),
  type: z.string().max(40),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ id: z.string().optional(), title: z.string().optional() }).optional(),
      list_reply: z.object({ id: z.string().optional(), title: z.string().optional() }).optional(),
    })
    .optional(),
  image: caption,
  video: caption,
  document: caption,
  context: z.object({ id: z.string().optional() }).optional(),
});
const deliverySchema = z.object({
  object: z.string().optional(),
  entry: z.array(z.object({
    changes: z.array(z.object({ field: z.string().optional(), value: z.record(z.string(), z.unknown()).optional() })).default([]),
  })).default([]),
});

export interface StatusEvent {
  key: string;
  wa_message_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: string | null;
  error_code: string | null;
  error_text: string | null;
  raw: unknown;
}

export interface InboundEvent {
  key: string;
  inbound: {
    wa_message_id: string;
    from: string;
    kind: "text" | "button_reply" | "media" | "other";
    text: string | null;
    at: string | null;
    context_wa_id: string | null;
    action: ReplyAction | null;
  };
  raw: unknown;
}

const iso = (s: string | undefined) => (s ? new Date(Number(s) * 1000).toISOString() : null);
const MEDIA = new Set(["image", "video", "audio", "document", "sticker"]);

/** One incoming message → what Postgres stores. */
export function toInbound(m: z.infer<typeof messageSchema>): InboundEvent["inbound"] {
  let kind: InboundEvent["inbound"]["kind"] = "other";
  let text: string | null = null;
  let action: ReplyAction | null = null;
  if (m.type === "text" && m.text) {
    kind = "text";
    text = m.text.body;
    action = classifyReply(text);
  } else if (m.type === "button" && m.button) {
    kind = "button_reply";
    text = m.button.text ?? m.button.payload ?? null;
    action = classifyButton(m.button.payload, m.button.text);
  } else if (m.type === "interactive" && m.interactive) {
    const r = m.interactive.button_reply ?? m.interactive.list_reply;
    kind = "button_reply";
    text = r?.title ?? r?.id ?? null;
    action = classifyButton(r?.id, r?.title);
  } else if (MEDIA.has(m.type)) {
    kind = "media";
    const c = (m as Record<string, unknown>)[m.type] as { caption?: string } | undefined;
    text = c?.caption ? `[${m.type}] ${c.caption}` : `[${m.type}]`;
  } else {
    text = `[${m.type}]`;
  }
  return {
    wa_message_id: m.id,
    from: `+${m.from}`,
    kind,
    text: text === null ? null : text.slice(0, 4096),
    at: iso(m.timestamp),
    context_wa_id: m.context?.id ?? null,
    action,
  };
}

/** Statuses and messages in a delivery. Items that do not look right are skipped, not fatal. */
export function parseDelivery(body: unknown): { statuses: StatusEvent[]; messages: InboundEvent[] } {
  const out = { statuses: [] as StatusEvent[], messages: [] as InboundEvent[] };
  const parsed = deliverySchema.safeParse(body);
  if (!parsed.success) return out;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages" || !change.value) continue;
      const statuses = Array.isArray(change.value.statuses) ? change.value.statuses : [];
      for (const raw of statuses) {
        const s = statusSchema.safeParse(raw);
        if (!s.success) continue;
        const err = s.data.errors?.[0];
        out.statuses.push({
          key: `status:${s.data.id}:${s.data.status}`,
          wa_message_id: s.data.id,
          status: s.data.status,
          at: iso(s.data.timestamp),
          error_code: err?.code === undefined ? null : String(err.code).slice(0, 40),
          error_text: err ? (err.error_data?.details ?? err.message ?? err.title ?? null)?.slice(0, 1000) ?? null : null,
          raw,
        });
      }
      const messages = Array.isArray(change.value.messages) ? change.value.messages : [];
      for (const raw of messages) {
        const m = messageSchema.safeParse(raw);
        if (!m.success) continue;
        out.messages.push({ key: `msg:${m.data.id}`, inbound: toInbound(m.data), raw });
      }
    }
  }
  return out;
}

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
}

async function must(p: Promise<{ data: unknown; error: { message: string } | null }>): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export async function applyDelivery(body: unknown, deps: Deps) {
  const { statuses, messages } = parseDelivery(body);
  const result = { statuses: 0, messages: 0, actions: [] as string[] };
  for (const s of statuses) {
    await must(deps.rpc("wa_status_update", {
      p_wa_message_id: s.wa_message_id, p_status: s.status, p_at: s.at, p_error_code: s.error_code, p_error_text: s.error_text,
    }));
    await must(deps.rpc("wa_webhook_seen", { p_key: s.key, p_kind: "status", p_payload: s.raw }));
    result.statuses++;
  }
  for (const m of messages) {
    const done = (await must(deps.rpc("wa_inbound", { p: m.inbound }))) as { action?: string | null } | null;
    if (done?.action) result.actions.push(done.action);
    await must(deps.rpc("wa_webhook_seen", { p_key: m.key, p_kind: "message", p_payload: m.raw }));
    result.messages++;
  }
  return result;
}

export interface WebhookInput {
  method: string;
  params: URLSearchParams;
  signature: string | null;
  raw: Uint8Array;
}

export async function webhook(input: WebhookInput, secrets: { appSecret: string; verifyToken: string }, deps: Deps) {
  if (input.method === "GET") {
    const c = challenge(input.params, secrets.verifyToken);
    return { status: c.status, text: c.body };
  }
  if (input.method !== "POST") return { status: 405, json: { error: "method_not_allowed" } };
  if (!secrets.appSecret) return { status: 503, json: { error: "not_configured" } };
  if (input.raw.byteLength > 1_000_000) return { status: 413, json: { error: "too_large" } };
  if (!(await signatureOk(input.raw, input.signature, secrets.appSecret))) return { status: 401, json: { error: "bad_signature" } };
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(input.raw));
  } catch {
    return { status: 400, json: { error: "invalid_input" } };
  }
  return { status: 200, json: await applyDelivery(body, deps) };
}
