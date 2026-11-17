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
 * The placeholders the server fills (private.summary_vars: an IP stay's or an OP visit's), in the
 * order the editor offers them. OP summaries fill visit_on / procedure_on / procedure / doctor, and
 * admitted_on / discharged_on / surgery_on / surgeon with the visit day and doctor; IP-only names
 * (ip_number, room, diagnosis, anaesthesia, times) stay unfilled there and block finalize.
 * Pronouns follow the patient's gender: female → she/her, male → he/him/his, other → they/them/their.
 */
export const PLACEHOLDER_NAMES = [
  "patient_name", "first_name", "age", "he_she", "He_She", "him_her", "Him_Her", "his_her", "His_Her",
  "uhid", "ip_number", "admitted_on", "admitted_at", "discharged_on", "discharged_at", "surgery_on", "surgery_at",
  "procedure", "diagnosis", "anaesthesia", "surgeon", "surgeons", "room", "doctor", "visit_on", "procedure_on",
  "clinic_name", "follow_up_days", "follow_up_date",
] as const;
