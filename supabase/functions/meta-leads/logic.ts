// meta-leads: the Meta Lead Ads webhook (PLAN.md D3).
//   GET  from Meta: the subscription check (hub.verify_token) → hub.challenge.
//   POST from Meta: signed with the app secret (X-Hub-Signature-256). Each leadgen id is
//        handled once: the form answers are fetched from the Graph API, mapped to lead
//        fields, and Postgres makes the lead (number dedupe, round-robin owner, notification).
//   POST from an admin (login token): {action: "retry", leadgen_id} tries a failed one again.
// Pure logic here; index.ts wires the real Graph API and database.
import { z } from "zod";
import { normalizePhone } from "../_shared/phone.ts";

/** An admin's "Try again" from the web app (login token, no Meta signature). */
export const retrySchema = z.object({ action: z.literal("retry"), leadgen_id: z.string().regex(/^[0-9]{5,30}$/) });

export const GRAPH_VERSION = "v23.0";
export const GRAPH_FIELDS = "field_data,created_time,ad_id,ad_name,adset_name,campaign_name,form_id,platform";

export type LeadField = "name" | "phone" | "alt_phone" | "email" | "treatment_text" | "comments1" | "comments2" | "ignore";
const LEAD_FIELDS: ReadonlySet<string> = new Set<LeadField>([
  "name", "phone", "alt_phone", "email", "treatment_text", "comments1", "comments2", "ignore",
]);

/** Meta's standard questions. Custom questions are mapped in Admin → Settings → Sales. */
export const DEFAULT_FIELD_MAP: Readonly<Record<string, LeadField>> = {
  full_name: "name",
  phone_number: "phone",
  email: "email",
};

export interface LeadgenRef {
  leadgen_id: string;
  page_id?: string;
  form_id?: string;
  ad_id?: string;
  created_time?: string;
}

export interface GraphLead {
  field_data?: { name: string; values?: string[] }[];
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
}

export interface MappedLead {
  name: string;
  phone: string;
  alt_phone?: string;
  email?: string;
  treatment_text?: string;
  comments1?: string;
  comments2?: string;
  source_code: "facebook" | "instagram";
  source_detail: Record<string, string>;
}

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  fetchLead: (leadgenId: string) => Promise<GraphLead>;
  fieldMap: () => Promise<Record<string, string>>;
}

export async function hmacHex(key: string, data: Uint8Array | string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const sig = await crypto.subtle.sign("HMAC", k, bytes as BufferSource);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
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

export function challenge(params: URLSearchParams, verifyToken: string): { status: number; body: string } {
  if (verifyToken && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === verifyToken) {
    return { status: 200, body: params.get("hub.challenge") ?? "" };
  }
  return { status: 403, body: "forbidden" };
}

const idText = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);

/** The leadgen events in a webhook delivery (other fields are ignored). */
export function leadgenRefs(body: unknown): LeadgenRef[] {
  const entries = (body as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return [];
  const out: LeadgenRef[] = [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const c = change as { field?: string; value?: Record<string, unknown> };
      const id = idText(c.value?.leadgen_id);
      if (c.field !== "leadgen" || !id || !/^[0-9A-Za-z_-]{1,64}$/.test(id)) continue;
      const created = Number(c.value?.created_time);
      out.push({
        leadgen_id: id,
        page_id: idText(c.value?.page_id),
        form_id: idText(c.value?.form_id),
        ad_id: idText(c.value?.ad_id),
        created_time: Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : undefined,
      });
    }
  }
  return out;
}

const readable = (key: string) => key.replace(/_/g, " ").replace(/\s+/g, " ").trim();

/** Form answers → lead fields. Unmapped questions go into Comments 2 as "question: answer". */
export function mapLead(lead: GraphLead, fieldMap: Record<string, string>): MappedLead | { error: "phone" } {
  const map: Record<string, string> = { ...DEFAULT_FIELD_MAP };
  for (const [k, v] of Object.entries(fieldMap ?? {})) if (LEAD_FIELDS.has(v)) map[k] = v;
  const got: Partial<Record<LeadField, string[]>> = {};
  const parts: Record<string, string> = {};
  for (const f of lead.field_data ?? []) {
    const value = (f.values ?? []).join(", ").trim();
    if (!value) continue;
    parts[f.name] = value;
    const target = (map[f.name] as LeadField | undefined) ??
      (f.name === "first_name" || f.name === "last_name" ? undefined : "comments2");
    if (!target || target === "ignore") continue;
    (got[target] ??= []).push(target === "comments2" && !map[f.name] ? `${readable(f.name)}: ${value}` : value);
  }
  const phone = normalizePhone(got.phone?.[0] ?? "");
  if (!phone) return { error: "phone" };
  const alt = got.alt_phone?.[0] ? normalizePhone(got.alt_phone[0]) : null;
  const name = got.name?.[0] || [parts.first_name, parts.last_name].filter(Boolean).join(" ") || phone.e164;
  const detail: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    campaign: lead.campaign_name, adset: lead.adset_name, ad: lead.ad_name, ad_id: lead.ad_id,
    form_id: lead.form_id, platform: lead.platform,
  })) if (v) detail[k] = String(v);
  const out: MappedLead = {
    name,
    phone: phone.e164,
    source_code: lead.platform === "ig" ? "instagram" : "facebook",
    source_detail: detail,
  };
  if (alt && alt.e164 !== phone.e164) out.alt_phone = alt.e164;
  if (got.email?.[0]) out.email = got.email[0];
  if (got.treatment_text?.length) out.treatment_text = got.treatment_text.join(", ");
  if (got.comments1?.length) out.comments1 = got.comments1.join("\n");
  if (got.comments2?.length) out.comments2 = got.comments2.join("\n");
  return out;
}

export type Outcome = { leadgen_id: string; status: "repeat" | "created" | "duplicate" | "failed" };

/** One leadgen id, start to finish. Database errors throw (Meta then retries the delivery). */
export async function processLeadgen(ref: LeadgenRef, deps: Deps): Promise<Outcome> {
  const received = await deps.rpc("meta_lead_received", {
    p_leadgen_id: ref.leadgen_id, p_page_id: ref.page_id ?? null, p_form_id: ref.form_id ?? null,
    p_ad_id: ref.ad_id ?? null, p_created_time: ref.created_time ?? null,
  });
  if (received.error) throw new Error(received.error.message);
  if (!(received.data as { process?: boolean } | null)?.process) return { leadgen_id: ref.leadgen_id, status: "repeat" };

  let lead: GraphLead;
  try {
    lead = await deps.fetchLead(ref.leadgen_id);
  } catch (e) {
    const failed = await deps.rpc("meta_lead_failed", { p_leadgen_id: ref.leadgen_id, p_error: `Meta: ${(e as Error).message}` });
    if (failed.error) throw new Error(failed.error.message);
    return { leadgen_id: ref.leadgen_id, status: "failed" };
  }
  const mapped = mapLead(lead, await deps.fieldMap());
  // No usable number: Postgres records the failure with the answers, for the admin to check the mapping.
  const payload = "error" in mapped ? { name: "", phone: "" } : mapped;
  const created = await deps.rpc("meta_lead_create", { p_leadgen_id: ref.leadgen_id, p_lead: payload, p_raw: lead });
  if (created.error) throw new Error(created.error.message);
  const status = (created.data as { status?: Outcome["status"] } | null)?.status ?? "failed";
  return { leadgen_id: ref.leadgen_id, status: status === "repeat" ? "repeat" : status };
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
  const results: Outcome[] = [];
  for (const ref of leadgenRefs(body)) results.push(await processLeadgen(ref, deps));
  return { status: 200, json: { results } };
}
