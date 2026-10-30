// wa-dispatch: sends queued WhatsApp messages through the Cloud API (PLAN.md D2).
//   Every 5 minutes from the database timer (pg_cron → pg_net, header x-cron-secret): queues
//   due reminders and drip steps first, then sends.
//   From the web app right after a staff send (login token): sends the queue now.
//   From the database when the chat bot queued a reply (cron secret, source "bot"): sends now.
// Postgres hands out each queued message to one run only (wa_claim_batch) and records Meta's
// answer (wa_mark_result): sent with Meta's id, retried later when temporary, failed otherwise.
// Pure logic here; index.ts wires the real Graph API and database.
import { z } from "zod";
import { sameText } from "../_shared/meta.ts";

export const dispatchSchema = z.object({ source: z.enum(["cron", "staff", "bot"]).optional() }).strict();
export type Source = "cron" | "staff" | "bot";

export const MAX_BATCHES = 5;
export const BATCH_SIZE = 20;
/** Numbers sent to at the same time (Meta allows far more; this keeps a run gentle). */
export const PARALLEL = 5;

export interface Claimed {
  id: string;
  to: string;
  kind: string;
  text: string | null;
  vars: unknown[] | null;
  template: { name: string; language: string; components?: unknown } | null;
  /** interactive: Meta's "interactive" object (buttons, the tick-box form); text: {preview_url}. */
  payload?: Record<string, unknown> | null;
}

export type SendResult = { ok: true; id: string } | ({ ok: false } & SendError);
export interface SendError {
  code: string;
  text: string;
  retry: boolean;
  /** Token or permission problem: every message would fail the same way. */
  auth: boolean;
}

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  send: (body: Record<string, unknown>) => Promise<SendResult>;
}

/** The cron secret from the header matches ours (both set). */
export function cronOk(header: string | null, secret: string): boolean {
  return !!secret && !!header && sameText(header, secret);
}

// Meta refuses parameters with new lines, tabs or more than four spaces in a row, and empty ones.
const param = (v: unknown) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1024) || "-";

/** One claimed row → the Cloud API request body, or null when there is nothing to send. */
export function messageBody(m: Claimed): Record<string, unknown> | null {
  const to = m.to.replace(/^\+/, "");
  if (!/^[1-9][0-9]{7,14}$/.test(to)) return null;
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (m.kind === "text") {
    const preview = m.payload?.preview_url === true;
    return m.text?.trim() ? { ...base, type: "text", text: { preview_url: preview, body: m.text.slice(0, 4096) } } : null;
  }
  if (m.kind === "interactive") {
    const i = m.payload;
    return i && typeof i.type === "string" && typeof i.action === "object" ? { ...base, type: "interactive", interactive: i } : null;
  }
  if (m.kind === "template" && m.template?.name) {
    const params = (m.vars ?? []).map((v) => ({ type: "text", text: param(v) }));
    return {
      ...base,
      type: "template",
      template: {
        name: m.template.name,
        language: { code: m.template.language || "en" },
        ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}),
      },
    };
  }
  return null;
}

// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const AUTH_CODES = new Set([0, 3, 10, 102, 190, 200]);
const RETRY_CODES = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

/** Meta's error → whether to try again later, and whether the token itself is the problem. */
export function classifyError(
  httpStatus: number,
  err: { code?: number | string; message?: string; error_data?: { details?: string } } | undefined,
): SendError {
  const code = Number(err?.code);
  const text = (err?.error_data?.details ?? err?.message ?? (httpStatus ? `HTTP ${httpStatus}` : "network error")).slice(0, 1000);
  const auth = httpStatus === 401 || (Number.isFinite(code) && AUTH_CODES.has(code) && httpStatus !== 0);
  const retry = auth || httpStatus === 0 || httpStatus === 429 || httpStatus >= 500 || (Number.isFinite(code) && RETRY_CODES.has(code));
  return { code: (Number.isFinite(code) ? String(code) : httpStatus ? `http_${httpStatus}` : "network").slice(0, 40), text, retry, auth };
}

async function must(p: Promise<{ data: unknown; error: { message: string } | null }>): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export interface Summary {
  source: Source;
  reminders: number;
  drips: number;
  sent: number;
  failed: number;
  retry: number;
  skipped?: "not_configured";
  error?: string;
}

export async function dispatch(opts: { source: Source; configured: boolean }, deps: Deps): Promise<Summary> {
  const s: Summary = { source: opts.source, reminders: 0, drips: 0, sent: 0, failed: 0, retry: 0 };
  if (opts.source === "cron") {
    s.reminders = Number(await must(deps.rpc("wa_due_reminders", {}))) || 0;
    s.drips = Number(await must(deps.rpc("wa_drip_due", { p_limit: 200 }))) || 0;
  }
  if (!opts.configured) {
    s.skipped = "not_configured";
    await must(deps.rpc("wa_integration_state", { p_state: "off", p_error: null }));
    if (opts.source === "cron") await must(deps.rpc("wa_log_run", { p_detail: s }));
    return s;
  }
  let authError: string | undefined;
  const sendOne = async (m: Claimed) => {
    const body = messageBody(m);
    let r: SendResult;
    if (authError) r = { ok: false, code: "auth", text: authError, retry: true, auth: true }; // don't hammer Meta with a bad token
    else if (!body) r = { ok: false, code: "bad_message", text: "Nothing to send (no text, template or valid number)", retry: false, auth: false };
    else r = await deps.send(body);
    if (r.ok) {
      await must(deps.rpc("wa_mark_result", { p_id: m.id, p_wa_message_id: r.id }));
      s.sent++;
    } else {
      await must(deps.rpc("wa_mark_result", {
        p_id: m.id, p_wa_message_id: null, p_error_code: r.code, p_error_text: r.text, p_retry: r.retry,
      }));
      if (r.retry) s.retry++;
      else s.failed++;
      if (r.auth) authError ??= r.text;
    }
  };
  for (let b = 0; b < MAX_BATCHES && !authError; b++) {
    const batch = ((await must(deps.rpc("wa_claim_batch", { p_limit: BATCH_SIZE }))) ?? []) as Claimed[];
    if (!batch.length) break;
    // Different numbers at the same time, one number's messages in order (the bot's
    // "Hi!" must arrive before its question).
    const byNumber = [...Map.groupBy(batch, (m) => m.to).values()];
    for (let i = 0; i < byNumber.length; i += PARALLEL) {
      await Promise.all(byNumber.slice(i, i + PARALLEL).map(async (msgs) => {
        for (const m of msgs) await sendOne(m);
      }));
    }
    if (batch.length < BATCH_SIZE) break;
  }
  if (authError) {
    s.error = authError;
    await must(deps.rpc("wa_integration_state", { p_state: "error", p_error: authError }));
  } else if (s.sent > 0) {
    await must(deps.rpc("wa_integration_state", { p_state: "ok", p_error: null }));
  }
  if (opts.source === "cron" || s.sent || s.failed || s.retry) await must(deps.rpc("wa_log_run", { p_detail: s }));
  return s;
}
