import { rupeesToPaise } from "./money";
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

/** Opening stock sheet columns (DocPulse stock export, Excel). */
const STOCK_COLUMNS: Record<string, string[]> = {
  name: ["name", "item", "item name", "product", "product name", "medicine", "medicine name", "drug"],
  strength: ["strength", "potency"],
  form: ["form", "dosage form", "type", "unit type"],
  manufacturer: ["manufacturer", "mfg", "mfr", "company", "make", "brand"],
  hsn: ["hsn", "hsn code", "hsn sac"],
  gst: ["gst", "gst %", "gst percent", "gst rate", "tax", "tax %", "tax rate"],
  mrp: ["mrp", "m r p"],
  selling_price: ["selling price", "sale price", "rate", "price", "sp"],
  purchase_price: ["purchase price", "cost", "cost price", "purchase rate", "pp"],
  batch_no: ["batch", "batch no", "batch number", "batchno", "lot", "lot no"],
  expiry_date: ["expiry", "expiry date", "exp", "exp date", "expdate", "expires"],
  qty: ["qty", "quantity", "stock", "closing stock", "balance", "on hand", "units"],
  reorder_level: ["reorder level", "reorder", "min stock", "minimum stock"],
  rack: ["rack", "shelf", "location", "bin"],
};

/** Which input column feeds each stock field (null = not present). */
export function mapStockColumns(header: string[]): Record<string, number | null> {
  // "GST %" and "Tax %" lose their "%" when cleaned; match on the cleaned names.
  const cleaned = header.map(clean);
  return Object.fromEntries(
    Object.entries(STOCK_COLUMNS).map(([field, names]) => {
      const i = cleaned.findIndex((h) => names.map(clean).includes(h));
      return [field, i >= 0 ? i : null];
    }),
  );
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Strip expiry → the first day of its month as "YYYY-MM-01" (the server stores the month's
 * last day). Accepts "03/27", "3/2027", "03-2027", "Mar-27", "Mar 2027", "31/03/2027", "2027-03-31".
 */
export function parseExpiry(text: string): string | null {
  const t = text.trim().toLowerCase();
  const full = parseDate(t);
  if (full) return `${full.slice(0, 7)}-01`;
  let m: number | undefined;
  let y: number | undefined;
  let match = /^(\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (match) [m, y] = [Number(match[1]), Number(match[2])];
  else if ((match = /^([a-z]{3})[a-z]*[\s/.-]*(\d{2}|\d{4})$/.exec(t))) {
    const i = MONTHS.indexOf(match[1]!);
    if (i >= 0) [m, y] = [i + 1, Number(match[2])];
  }
  if (m === undefined || y === undefined || m < 1 || m > 12) return null;
  if (y < 100) y += 2000;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** One stock row → the import_opening_stock payload. Money in paise, GST in basis points. */
export function mapStockRow(cells: string[], columns: Record<string, number | null>): MappedRow {
  const get = (field: string) => {
    const i = columns[field];
    return i === null || i === undefined ? "" : (cells[i] ?? "").trim();
  };
  const problems: string[] = [];
  const row: Record<string, unknown> = {};
  const name = get("name").replace(/\s+/g, " ");
  if (!name) problems.push("name");
  row.name = name;
  for (const k of ["strength", "form", "manufacturer", "rack"]) if (get(k)) row[k] = get(k);
  const hsn = get("hsn").replace(/\s/g, "");
  if (hsn) {
    if (/^[0-9]{4,8}$/.test(hsn)) row.hsn = hsn;
    else problems.push("hsn");
  }
  const gst = get("gst").replace(/%/g, "").trim();
  if (gst) {
    const pct = Number(gst);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 40) row.gst_rate_bp = Math.round(pct * 100);
    else problems.push("gst");
  }
  for (const [field, key] of [["mrp", "mrp_paise"], ["selling_price", "selling_price_paise"], ["purchase_price", "purchase_price_paise"]] as const) {
    const v = get(field);
    if (!v) continue;
    try {
      const paise = rupeesToPaise(v);
      if (paise < 0) throw new Error("negative");
      row[key] = paise;
    } catch {
      problems.push(field);
    }
  }
  const batch = get("batch_no");
  if (batch) row.batch_no = batch;
  else problems.push("batch_no");
  const expiry = parseExpiry(get("expiry_date"));
  if (expiry) row.expiry_date = expiry;
  else problems.push("expiry_date");
  const qty = Number(get("qty").replace(/,/g, ""));
  if (get("qty") && Number.isFinite(qty) && qty > 0 && Math.round(qty * 1000) === qty * 1000) row.qty = qty;
  else problems.push("qty");
  const reorder = get("reorder_level");
  if (reorder) {
    const n = Number(reorder);
    if (Number.isFinite(n) && n >= 0) row.reorder_level = n;
    else problems.push("reorder_level");
  }
  return { row, problems };
}

/** Lead sheet columns (the sales team's Excel, Meta exports). */
const LEAD_COLUMNS: Record<string, string[]> = {
  name: ["name", "lead name", "patient name", "full name", "customer name", "client name"],
  phone: ["phone", "mobile", "mobile no", "mobile number", "phone no", "phone number", "contact", "contact no", "number", "phone 1"],
  alt_phone: ["alt phone", "alternate phone", "alternate number", "alternate mobile", "alt mobile", "phone 2", "mobile 2", "other number"],
  email: ["email", "email id", "e mail"],
  lead_date: ["date", "lead date", "enquiry date", "created", "created on", "created date"],
  treatment: ["treatment", "procedure", "interested in", "service"],
  source: ["source", "lead source", "channel", "platform"],
  assigned: ["assigned to", "assigned", "owner", "executive", "sales executive", "telecaller", "caller"],
  referred_by: ["referred by", "referral", "reference"],
  comments1: ["comments 1", "comment 1", "comments", "comment", "remarks", "notes"],
  comments2: ["comments 2", "comment 2", "remarks 2", "notes 2"],
  amount_quoted: ["amount quoted", "quoted", "quote", "quoted amount"],
  amount_finalised: ["amount finalised", "amount finalized", "finalised amount", "finalized amount", "final amount", "agreed amount"],
  stage: ["stage", "status", "lead status"],
  lost_reason: ["lost reason", "reason"],
  next_followup: ["due date", "follow up", "followup", "next follow up", "follow up date", "next call", "next followup"],
};

/** Which input column feeds each lead field (null = not present). */
export function mapLeadColumns(header: string[]): Record<string, number | null> {
  const cleaned = header.map(clean);
  return Object.fromEntries(
    Object.entries(LEAD_COLUMNS).map(([field, names]) => {
      const i = cleaned.findIndex((h) => names.includes(h));
      return [field, i >= 0 ? i : null];
    }),
  );
}

/** The words sales sheets use for a stage → our stage (undefined = not recognised). */
export function parseLeadStage(text: string): string | undefined {
  const t = clean(text);
  const words: [RegExp, string][] = [
    [/^(new|fresh|open)$/, "new"],
    [/^(contacted|called|spoke|talked)$/, "contacted"],
    [/^(interested|hot|warm)$/, "interested"],
    [/^((consultation |appointment )?booked|consultation booked|appointment)$/, "consultation_booked"],
    [/^(consulted|visited|came|walked in)$/, "consulted"],
    [/^surgery (scheduled|booked|fixed)$/, "surgery_scheduled"],
    [/^(converted|won|done|closed won|joined)$/, "converted"],
    [/^(lost|not interested|closed lost|dropped)$/, "lost"],
    [/^(not reachable|no answer|rnr|unreachable|switched off|not picking)$/, "not_reachable"],
    [/^(junk|invalid|spam|wrong number|fake)$/, "junk"],
  ];
  return words.find(([re]) => re.test(t))?.[1];
}

/** One lead row → the import_leads payload: E.164 numbers, paise, ISO dates (follow-ups at 10:00 IST). */
export function mapLeadRow(cells: string[], columns: Record<string, number | null>): MappedRow {
  const get = (field: string) => {
    const i = columns[field];
    return i === null || i === undefined ? "" : (cells[i] ?? "").trim();
  };
  const problems: string[] = [];
  const row: Record<string, unknown> = {};
  const name = get("name").replace(/\s+/g, " ");
  if (!name) problems.push("name");
  row.name = name;
  for (const [field, key] of [["phone", "phone"], ["alt_phone", "alt_phone"]] as const) {
    const v = get(field);
    if (!v) {
      if (field === "phone") problems.push("phone");
      continue;
    }
    const n = normalizePhone(v);
    if (n) row[key] = n.e164;
    else problems.push(field);
  }
  for (const k of ["email", "treatment", "source", "assigned", "referred_by", "comments1", "comments2", "lost_reason"]) {
    if (get(k)) row[k] = get(k);
  }
  for (const [field, key] of [["lead_date", "lead_date"], ["next_followup", "next_followup_at"]] as const) {
    const v = get(field);
    if (!v) continue;
    const iso = parseDate(v);
    if (!iso) problems.push(field);
    else row[key] = field === "lead_date" ? iso : `${iso}T10:00:00+05:30`;
  }
  for (const [field, key] of [["amount_quoted", "amount_quoted_paise"], ["amount_finalised", "amount_finalised_paise"]] as const) {
    const v = get(field).replace(/[₹,\s]/g, "");
    if (!v) continue;
    try {
      const paise = rupeesToPaise(v);
      if (paise < 0) throw new Error("negative");
      row[key] = paise;
    } catch {
      problems.push(field);
    }
  }
  if (get("stage")) {
    const stage = parseLeadStage(get("stage"));
    if (stage) row.stage = stage;
    else problems.push("stage");
  }
  return { row, problems };
}
