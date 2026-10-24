// wa-templates-sync: Admin → WhatsApp buttons (admin login only).
//   {action: "test"} checks the keys by reading the WhatsApp number from Meta.
//   {action: "sync"} copies the message templates from Meta into the CRM. Purposes and
//   variable maps chosen in the CRM are kept; templates Meta no longer has are switched off.
// Pure logic here; index.ts wires the real Graph API and database.
import { z } from "zod";

/** A refusal or outage on Meta's side (shown to the admin as is). */
export class GraphError extends Error {}

export const syncSchema = z.object({ action: z.enum(["sync", "test"]) }).strict();

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
  | { status: 200; body: { action: "sync"; count: number; skipped: number } | ({ action: "test" } & PhoneInfo) }
  | { status: 502 | 503; body: { error: "not_configured" | "whatsapp_api"; detail?: string } };

export async function run(action: "sync" | "test", configured: boolean, deps: Deps): Promise<Outcome> {
  if (!configured) {
    await must(deps.rpc("wa_integration_state", { p_state: "off", p_error: null }));
    return { status: 503, body: { error: "not_configured" } };
  }
  try {
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
    return { status: 200, body: { action, count, skipped: all.length - rows.length } };
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
