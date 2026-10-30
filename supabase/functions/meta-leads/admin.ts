// meta-leads, staff actions from the web app (login token, no Meta signature):
//   {action: "check"}   Admin → Meta lead ads "Check connection": each step of the connection, ✓ or ✗ with Meta's reason.
//   {action: "connect"} subscribes the Facebook Page to this app's "leadgen" webhook (needs pages_manage_metadata).
//   {action: "import", days} Ads page "Import past leads": the lead forms' leads of the last `days` days,
//        quietly (no alerts per lead, no WhatsApp welcome, no drips; one summary alert per owner).
//        Stops before the function's time limit and says so; running it again carries on (each
//        leadgen id is handled once).
// The page's own key is fetched with the system-user key each time (Meta wants a Page key for forms).
import { z } from "zod";
import { type GraphLead, mapLead, retrySchema } from "./logic.ts";

export const adminSchema = z.discriminatedUnion("action", [
  retrySchema,
  z.object({ action: z.literal("check") }).strict(),
  z.object({ action: z.literal("connect") }).strict(),
  z.object({ action: z.literal("import"), days: z.number().int().min(1).max(90) }).strict(),
]);
export type AdminRequest = z.infer<typeof adminSchema>;

/** Fields read for each old lead (as the webhook's GRAPH_FIELDS, plus its id). */
export const IMPORT_FIELDS = "id,field_data,created_time,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform";

export interface AdminDeps {
  /** GET a Graph API path (or Meta's full `next` link) with the given key. Throws Error(Meta's message). */
  graph: (pathOrUrl: string, key: string, params?: Record<string, string>) => Promise<Record<string, unknown>>;
  /** POST a Graph API path with the given key. */
  post: (path: string, key: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  fieldMap: () => Promise<Record<string, string>>;
  systemKey: string;
  pageId: string;
  appId: string;
  now: () => number;
}

export type StepKey = "token" | "page" | "leads" | "webhook" | "ads";
export interface Step {
  key: StepKey;
  ok: boolean;
  detail?: string;
}

const message = (e: unknown) => ((e as Error)?.message ?? "error").slice(0, 300);

async function pageKey(deps: AdminDeps): Promise<{ name: string; key: string }> {
  const p = await deps.graph(deps.pageId, deps.systemKey, { fields: "name,access_token" });
  if (typeof p.access_token !== "string") throw new Error("This key can't act for the Facebook Page (give the system user the Page).");
  return { name: String(p.name ?? deps.pageId), key: p.access_token };
}

/** Each step of the connection, in order; a step that can't be tried after a failure is shown as failed too. */
export async function check(deps: AdminDeps): Promise<{ steps: Step[]; can_connect: boolean }> {
  const steps: Step[] = [];
  let page: { name: string; key: string } | null = null;
  try {
    const me = await deps.graph("me", deps.systemKey, { fields: "id,name" });
    steps.push({ key: "token", ok: true, detail: String(me.name ?? "") });
  } catch (e) {
    steps.push({ key: "token", ok: false, detail: message(e) });
  }
  try {
    page = await pageKey(deps);
    steps.push({ key: "page", ok: true, detail: page.name });
  } catch (e) {
    steps.push({ key: "page", ok: false, detail: message(e) });
  }
  if (page) {
    try {
      const forms = ((await deps.graph(`${deps.pageId}/leadgen_forms`, page.key, { fields: "id,status", limit: "100" })).data ?? []) as { id: string }[];
      if (forms[0]) await deps.graph(`${forms[0].id}/leads`, page.key, { fields: "id", limit: "1" });
      steps.push({ key: "leads", ok: true, detail: String(forms.length) });
    } catch (e) {
      steps.push({ key: "leads", ok: false, detail: message(e) });
    }
    try {
      const apps = ((await deps.graph(`${deps.pageId}/subscribed_apps`, page.key)).data ?? []) as { id?: string; subscribed_fields?: string[] }[];
      const ours = apps.find((a) => !deps.appId || a.id === deps.appId);
      const ok = !!ours?.subscribed_fields?.includes("leadgen");
      steps.push({ key: "webhook", ok, detail: ok ? undefined : "not_subscribed" });
    } catch (e) {
      steps.push({ key: "webhook", ok: false, detail: message(e) });
    }
  } else {
    steps.push({ key: "leads", ok: false }, { key: "webhook", ok: false });
  }
  try {
    const acts = ((await deps.graph("me/adaccounts", deps.systemKey, { fields: "name,account_status", limit: "10" })).data ?? []) as { name?: string }[];
    steps.push({ key: "ads", ok: acts.length > 0, detail: acts.length ? acts.map((a) => a.name).join(", ") : "no_ad_account" });
  } catch (e) {
    steps.push({ key: "ads", ok: false, detail: message(e) });
  }
  const webhook = steps.find((s) => s.key === "webhook");
  return { steps, can_connect: !!page && !!webhook && !webhook.ok && webhook.detail === "not_subscribed" };
}

/** Subscribes the Page to this app's leadgen webhook. */
export async function connect(deps: AdminDeps): Promise<{ ok: boolean; error?: string }> {
  try {
    const page = await pageKey(deps);
    const r = await deps.post(`${deps.pageId}/subscribed_apps`, page.key, { subscribed_fields: "leadgen" });
    return r.success === true ? { ok: true } : { ok: false, error: "Meta said no" };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export interface ImportSummary {
  forms: number;
  seen: number;
  created: number;
  duplicate: number;
  failed: number;
  already: number;
  done: boolean;
  error?: string;
}

async function must(p: Promise<{ data: unknown; error: { message: string } | null }>): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

/** Old leads from every lead form, newest form pages first; stops at `deadline` (ms since epoch). */
export async function importLeads(days: number, deadline: number, deps: AdminDeps): Promise<ImportSummary> {
  const s: ImportSummary = { forms: 0, seen: 0, created: 0, duplicate: 0, failed: 0, already: 0, done: false };
  const createdIds: string[] = [];
  try {
    const page = await pageKey(deps);
    const map = await deps.fieldMap();
    const since = Math.floor(deps.now() / 1000) - days * 86_400;
    const forms: { id: string }[] = [];
    let next: string | null = `${deps.pageId}/leadgen_forms`;
    for (let i = 0; next && i < 10; i++) {
      const body = await deps.graph(next, page.key, i === 0 ? { fields: "id", limit: "100" } : undefined);
      forms.push(...((body.data as { id: string }[] | undefined) ?? []));
      next = (body.paging as { next?: string } | undefined)?.next ?? null;
    }
    s.forms = forms.length;
    outer: for (const form of forms) {
      let link: string | null = `${form.id}/leads`;
      for (let i = 0; link && i < 50; i++) {
        if (deps.now() > deadline) break outer;
        const body = await deps.graph(link, page.key, i === 0
          ? { fields: IMPORT_FIELDS, limit: "100", filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]) }
          : undefined);
        for (const lead of (body.data as (GraphLead & { id: string })[] | undefined) ?? []) {
          if (deps.now() > deadline) break outer;
          s.seen++;
          const received = (await must(deps.rpc("meta_lead_received", {
            p_leadgen_id: lead.id, p_page_id: deps.pageId, p_form_id: lead.form_id ?? form.id,
            p_ad_id: lead.ad_id ?? null, p_created_time: lead.created_time ?? null,
          }))) as { process?: boolean } | null;
          if (!received?.process) {
            s.already++;
            continue;
          }
          const mapped = mapLead(lead, map);
          const payload = "error" in mapped ? { name: "", phone: "" } : mapped;
          const r = (await must(deps.rpc("meta_lead_import", { p_leadgen_id: lead.id, p_lead: payload, p_raw: lead }))) as
            { status?: string; lead_id?: string } | null;
          if (r?.status === "created") {
            s.created++;
            if (r.lead_id) createdIds.push(r.lead_id);
          } else if (r?.status === "duplicate") s.duplicate++;
          else s.failed++;
        }
        link = (body.paging as { next?: string } | undefined)?.next ?? null;
      }
    }
    s.done = deps.now() <= deadline;
  } catch (e) {
    s.error = message(e);
  }
  if (createdIds.length) await deps.rpc("meta_lead_import_summary", { p_lead_ids: createdIds });
  return s;
}
