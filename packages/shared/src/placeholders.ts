/**
 * Discharge-summary placeholders: "{{He_She}} underwent {{procedure}} on {{surgery_on}}".
 * Filled in one left-to-right pass; unknown names, or names without a value, stay as they
 * are so that finalize refuses them. SQL does the same (private.render_placeholders); both
 * are tested against test-vectors/placeholders.json.
 */
const TOKEN = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;
const LEFTOVER = /\{\{([^}]*)\}\}/g;

export type PlaceholderVars = Record<string, string | null | undefined>;

export function renderPlaceholders(text: string | null | undefined, vars: PlaceholderVars): string {
  return (text ?? "").replace(TOKEN, (token, name: string) => {
    const value = vars[name];
    return value ? value : token;
  });
}

/** Names still in {{…}} after filling, without duplicates, in order of first use. */
export function leftoverPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(LEFTOVER)].map((m) => m[1]!.trim()))];
}

/**
 * The placeholders the server fills (private.discharge_vars), in the order the editor offers them.
 * Pronouns follow the patient's gender: female → she/her, male → he/him/his, other → they/them/their.
 */
export const PLACEHOLDER_NAMES = [
  "patient_name", "first_name", "age", "he_she", "He_She", "him_her", "Him_Her", "his_her", "His_Her",
  "uhid", "ip_number", "admitted_on", "admitted_at", "discharged_on", "discharged_at", "surgery_on", "surgery_at",
  "procedure", "diagnosis", "anaesthesia", "surgeon", "surgeons", "room", "clinic_name", "follow_up_days", "follow_up_date",
] as const;
