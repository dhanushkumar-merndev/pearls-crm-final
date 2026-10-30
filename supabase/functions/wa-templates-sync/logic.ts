// wa-templates-sync: Admin → WhatsApp buttons (admin login only).
//   {action: "test"} checks the keys by reading the WhatsApp number from Meta.
//   {action: "sync"} copies the message templates from Meta into the CRM. Purposes and
//   variable maps chosen in the CRM are kept; templates Meta no longer has are switched off.
//   {action: "flow", title, button} makes the chat bot's tick-box form (a WhatsApp Flow) and
//   publishes it. The treatment list is not in the form: the bot sends the current list each
//   time, so editing it in Admin needs no new form. Meta publishes only for a verified business;
//   until then the form stays a draft, the bot asks for numbers, and pressing again retries.
// Pure logic here; index.ts wires the real Graph API and database.
import { z } from "zod";

/** A refusal or outage on Meta's side (shown to the admin as is). */
export class GraphError extends Error {}

export const syncSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["sync", "test"]) }).strict(),
  z.object({
    action: z.literal("flow"),
    title: z.string().trim().min(1).max(30),
    button: z.string().trim().min(1).max(30),
  }).strict(),
]);
export type SyncRequest = z.infer<typeof syncSchema>;

export interface GraphTemplate {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  components?: { type?: string; text?: string }[];
}

export interface PhoneInfo {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  listTemplates: () => Promise<GraphTemplate[]>;
  phoneInfo: () => Promise<PhoneInfo>;
  /** POST {waba}/flows → the new draft's id (Meta's validation errors throw a GraphError). */
  createFlow: (name: string, flowJson: string) => Promise<string>;
  /** POST {flow}/publish (throws a GraphError with Meta's reason when it refuses). */
  publishFlow: (id: string) => Promise<void>;
  now?: () => number;
}

export const FLOW_JSON_VERSION = "7.1";
export const FLOW_SCREEN = "PICK";

/**
 * The form: one screen with a tick-box group filled from the message (data.options, data.label)
 * and a button that sends {choices: [...]} back. Postgres builds the matching message
 * (private.wa_bot_ask: screen "PICK", data {label, options}).
 */
export function flowJson(title: string, button: string) {
  return {
    version: FLOW_JSON_VERSION,
    screens: [
      {
        id: FLOW_SCREEN,
        title,
        terminal: true,
        success: true,
        data: {
          label: { type: "string", __example__: "Choose treatments" },
          options: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } },
            __example__: [{ id: "Treatment A", title: "Treatment A" }, { id: "Treatment B", title: "Treatment B" }],
          },
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "CheckboxGroup", name: "choices", label: "${data.label}", "data-source": "${data.options}", required: true, "min-selected-items": 1 },
            { type: "Footer", label: button, "on-click-action": { name: "complete", payload: { choices: "${form.choices}" } } },
          ],
        },
      },
    ],
  };
}

/** How many values a body needs: {{1}} … {{n}} (positional) or distinct {{named}} ones. */
export function paramCount(text: string | undefined): number {
  const found = [...(text ?? "").matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]!.toLowerCase());
  const numbers = found.filter((f) => /^[0-9]+$/.test(f)).map(Number);
  if (numbers.length === found.length) return numbers.length ? Math.max(...numbers) : 0;
  return new Set(found).size;
}

const CATEGORIES = new Set(["marketing", "utility", "authentication"]);

/** Meta's template → the row Postgres stores, or null when it cannot be used. */
export function toRow(t: GraphTemplate) {
  if (!t.id || !t.name || !/^[a-z0-9_]{1,512}$/.test(t.name)) return null;
  const language = t.language && /^[a-zA-Z_]{2,10}$/.test(t.language) ? t.language : "en";
  const category = (t.category ?? "").toLowerCase();
  const body = (t.components ?? []).find((c) => (c.type ?? "").toUpperCase() === "BODY")?.text ?? "";
  return {
    id: t.id,
    name: t.name,
    language,
    category: CATEGORIES.has(category) ? category : "utility",
    status: (t.status ?? "PENDING").toUpperCase().slice(0, 40),
    components: Array.isArray(t.components) ? t.components : [],
    body_text: body.slice(0, 2000),
    param_count: Math.min(paramCount(body), 20),
  };
}

async function must(p: Promise<{ data: unknown; error: { message: string } | null }>): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export type Outcome =
  | {
    status: 200;
    body:
      | { action: "sync"; count: number; skipped: number }
      | ({ action: "test" } & PhoneInfo)
      | { action: "flow"; flow_id: string; published: true };
  }
  | { status: 502 | 503; body: { error: "not_configured" | "whatsapp_api"; detail?: string } };

const ID = /^[0-9]{5,30}$/;

async function setUpFlow(req: { title: string; button: string }, deps: Deps): Promise<Outcome> {
  const state = (await must(deps.rpc("wa_bot_flow_get", {}))) as { flow_id?: unknown; flow_draft_id?: unknown } | null;
  if (typeof state?.flow_id === "string" && ID.test(state.flow_id)) {
    return { status: 200, body: { action: "flow", flow_id: state.flow_id, published: true } };
  }
  let id = typeof state?.flow_draft_id === "string" && ID.test(state.flow_draft_id) ? state.flow_draft_id : null;
  if (!id) {
    const name = `crm_treatments_${(deps.now ?? Date.now)()}`;
    id = await deps.createFlow(name, JSON.stringify(flowJson(req.title, req.button)));
    if (!ID.test(id)) throw new GraphError("Meta did not return a form id");
    await must(deps.rpc("wa_bot_flow_saved", { p_flow_id: id, p_published: false }));
  }
  await deps.publishFlow(id);
  await must(deps.rpc("wa_bot_flow_saved", { p_flow_id: id, p_published: true }));
  return { status: 200, body: { action: "flow", flow_id: id, published: true } };
}

export async function run(request: SyncRequest | SyncRequest["action"], configured: boolean, deps: Deps): Promise<Outcome> {
  const req: SyncRequest = typeof request === "string" ? ({ action: request } as SyncRequest) : request;
  const action = req.action;
  if (!configured) {
    await must(deps.rpc("wa_integration_state", { p_state: "off", p_error: null }));
    return { status: 503, body: { error: "not_configured" } };
  }
  try {
    if (req.action === "flow") return await setUpFlow(req, deps);
    if (action === "test") {
      const info = await deps.phoneInfo();
      await must(deps.rpc("wa_integration_state", { p_state: "ok", p_error: null }));
      return {
        status: 200,
        body: { action, display_phone_number: info.display_phone_number, verified_name: info.verified_name, quality_rating: info.quality_rating },
      };
    }
    const all = await deps.listTemplates();
    const rows = all.map(toRow).filter((r) => r !== null);
    const count = Number(await must(deps.rpc("wa_templates_upsert", { p_templates: rows }))) || 0;
    await must(deps.rpc("wa_integration_state", { p_state: "ok", p_error: null }));
    return { status: 200, body: { action: "sync", count, skipped: all.length - rows.length } };
  } catch (e) {
    const detail = (e as Error).message.slice(0, 500);
    // Database errors are ours, not Meta's: let them surface as a crash (500).
    if (e instanceof GraphError) {
      await must(deps.rpc("wa_integration_state", { p_state: "error", p_error: detail }));
      return { status: 502, body: { error: "whatsapp_api", detail } };
    }
    throw e;
  }
}
