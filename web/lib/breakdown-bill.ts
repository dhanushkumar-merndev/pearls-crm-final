import { computeLine } from "@pearl/shared";

/** A category picked from the library ({id, label, …}); only id and label matter here. */
export interface PickedCategory {
  id: string;
  label: string;
}

/** One breakdown line as the editor holds it (amounts in paise; qty as typed). */
export interface BreakdownEditLine {
  key: string;
  category: PickedCategory | null;
  description: string;
  service_date: string;
  qty: string;
  unit_paise: number | null;
  amount_paise: number | null;
  gst_rate_bp: number;
  source_bill_item_id: string | null;
}

/** A stored line (breakdown_card → lines). */
export interface BreakdownLineRow {
  id: string;
  line_no: number;
  category_id: string | null;
  category: string | null;
  category_code?: string | null;
  description: string;
  service_date: string | null;
  qty: number | string;
  unit_paise: number;
  gst_rate_bp: number;
  amount_paise: number;
  source_bill_item_id: string | null;
}

let seq = 0;
const nextKey = () => `bl-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function lineFromRow(r: BreakdownLineRow): BreakdownEditLine {
  return {
    key: r.id,
    category: r.category_id ? { id: r.category_id, label: r.category ?? "" } : null,
    description: r.description,
    service_date: r.service_date ?? "",
    qty: String(Number(r.qty)),
    unit_paise: r.unit_paise,
    amount_paise: r.amount_paise,
    gst_rate_bp: r.gst_rate_bp,
    source_bill_item_id: r.source_bill_item_id,
  };
}

export function emptyBreakdownLine(after?: BreakdownEditLine): BreakdownEditLine {
  return {
    key: nextKey(),
    category: after?.category ?? null,
    description: "",
    service_date: after?.service_date ?? "",
    qty: "1",
    unit_paise: null,
    amount_paise: null,
    gst_rate_bp: 0,
    source_bill_item_id: null,
  };
}

const qtyOf = (l: Pick<BreakdownEditLine, "qty">) => {
  const q = Number(l.qty);
  return Number.isFinite(q) && q > 0 ? q : null;
};

/** Rate or quantity changed: amount = qty × rate (rounded to the paisa). */
export function withQtyOrRate(l: BreakdownEditLine, patch: Partial<Pick<BreakdownEditLine, "qty" | "unit_paise">>): BreakdownEditLine {
  const next = { ...l, ...patch };
  const q = qtyOf(next);
  return { ...next, amount_paise: q !== null && next.unit_paise !== null ? Math.round(next.unit_paise * q) : next.amount_paise };
}

/** Amount typed: the rate follows (amount ÷ qty), so the printed line still reads qty × rate ≈ amount. */
export function withAmount(l: BreakdownEditLine, amount: number | null): BreakdownEditLine {
  const q = qtyOf(l);
  return { ...l, amount_paise: amount, unit_paise: amount !== null && q !== null ? Math.round(amount / q) : l.unit_paise };
}

/**
 * Split a line in two (e.g. a package into surgeon fee + OT charges): the new line goes right under it
 * with half the amount (the odd paisa stays on the first), so the total doesn't change. The second
 * line's description is left empty for staff to name.
 */
export function splitLine(lines: BreakdownEditLine[], key: string): BreakdownEditLine[] {
  const i = lines.findIndex((l) => l.key === key);
  if (i < 0) return lines;
  const l = lines[i]!;
  const amount = l.amount_paise ?? 0;
  const second = Math.floor(amount / 2);
  const first = { ...withAmount({ ...l, qty: "1" }, amount - second), source_bill_item_id: l.source_bill_item_id };
  const added = { ...withAmount({ ...emptyBreakdownLine(l), qty: "1" }, second), gst_rate_bp: l.gst_rate_bp };
  return [...lines.slice(0, i), first, added, ...lines.slice(i + 1)];
}

export function moveLine(lines: BreakdownEditLine[], key: string, by: -1 | 1): BreakdownEditLine[] {
  const i = lines.findIndex((l) => l.key === key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= lines.length) return lines;
  const out = [...lines];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export const linesTotal = (lines: Pick<BreakdownEditLine, "amount_paise">[]) => lines.reduce((s, l) => s + (l.amount_paise ?? 0), 0);

/** What the save RPC takes for a line. */
export function toBreakdownPayload(l: BreakdownEditLine) {
  return {
    category_id: l.category?.id ?? null,
    description: l.description.trim(),
    service_date: l.service_date || null,
    qty: qtyOf(l) ?? 1,
    unit_paise: l.unit_paise ?? 0,
    gst_rate_bp: l.gst_rate_bp,
    amount_paise: l.amount_paise ?? 0,
    source_bill_item_id: l.source_bill_item_id,
  };
}

export interface GstIncludedRow {
  rate_bp: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
}

/**
 * GST inside the printed amounts (they include GST), by rate, lowest first; tax-free lines left out.
 * Same inclusive maths as a bill line (packages/shared/src/gst.ts).
 */
export function gstIncluded(lines: { gst_rate_bp: number; amount_paise: number }[]): GstIncludedRow[] {
  const byRate = new Map<number, GstIncludedRow>();
  for (const l of lines) {
    if (l.gst_rate_bp <= 0 || l.amount_paise <= 0) continue;
    const r = computeLine({ ratePaise: l.amount_paise, qtyMilli: 1000, discountType: "amount", discountValue: 0, gstRateBp: l.gst_rate_bp, taxInclusive: true });
    const row = byRate.get(l.gst_rate_bp) ?? { rate_bp: l.gst_rate_bp, taxable_paise: 0, cgst_paise: 0, sgst_paise: 0 };
    row.taxable_paise += r.taxablePaise;
    row.cgst_paise += r.cgstPaise;
    row.sgst_paise += r.sgstPaise;
    byRate.set(l.gst_rate_bp, row);
  }
  return [...byRate.values()].sort((a, b) => a.rate_bp - b.rate_bp);
}
