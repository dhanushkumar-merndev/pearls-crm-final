import { normalizePhone } from "./phone";

/** Column names people use (DocPulse, Excel sheets), lower-cased without punctuation. */
const PATIENT_COLUMNS: Record<string, string[]> = {
  full_name: ["name", "patient name", "full name", "patientname", "patient"],
  phone_e164: ["mobile", "mobile no", "mobile number", "phone", "phone no", "phone number", "contact", "contact no"],
  gender: ["gender", "sex"],
  dob: ["dob", "date of birth", "birth date", "birthdate"],
  age_years: ["age", "age years", "age in years"],
  uhid: ["uhid", "mrn", "patient id", "patient no", "reg no", "registration no", "uh id"],
  email: ["email", "email id", "e mail"],
  address: ["address", "address line", "street"],
  area: ["area", "locality"],
  city: ["city", "town"],
  pincode: ["pincode", "pin", "pin code", "zip", "postal code"],
};

const clean = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which input column feeds each patient field (null = not present). */
export function mapPatientColumns(header: string[]): Record<string, number | null> {
  const cleaned = header.map(clean);
  return Object.fromEntries(
    Object.entries(PATIENT_COLUMNS).map(([field, names]) => {
      const i = cleaned.findIndex((h) => names.includes(h));
      return [field, i >= 0 ? i : null];
    }),
  );
}

/** "31/03/1990", "31-03-1990", "1990-03-31" → "1990-03-31"; anything else → null. */
export function parseDate(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (match) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface MappedRow {
  row: Record<string, unknown>;
  problems: string[];
}

/** One sheet row → the import_patients payload, with problems found before sending. */
export function mapPatientRow(cells: string[], columns: Record<string, number | null>): MappedRow {
  const get = (field: string) => {
    const i = columns[field];
    return i === null || i === undefined ? "" : (cells[i] ?? "").trim();
  };
  const problems: string[] = [];
  const row: Record<string, unknown> = {};
  const name = get("full_name").replace(/\s+/g, " ");
  if (!name) problems.push("full_name");
  row.full_name = name;
  const phone = get("phone_e164");
  if (phone) {
    const n = normalizePhone(phone);
    if (n) row.phone_e164 = n.e164;
    else problems.push("phone_e164");
  }
  const gender = get("gender").toLowerCase();
  row.gender = /^(f|female|woman)$/.test(gender) ? "female" : /^(m|male|man)$/.test(gender) ? "male" : gender ? "other" : "unknown";
  const dob = get("dob");
  if (dob) {
    const iso = parseDate(dob);
    if (iso) row.dob = iso;
    else problems.push("dob");
  } else if (get("age_years")) {
    const age = Number.parseInt(get("age_years"), 10);
    if (Number.isInteger(age) && age >= 0 && age <= 120) row.age_years = age;
    else problems.push("age_years");
  }
  for (const k of ["uhid", "email", "address", "area", "city"]) if (get(k)) row[k] = get(k);
  const pin = get("pincode");
  if (pin) {
    if (/^[1-9][0-9]{5}$/.test(pin)) row.pincode = pin;
    else problems.push("pincode");
  }
  return { row, problems };
}
