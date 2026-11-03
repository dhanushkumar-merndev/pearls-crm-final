/** The lines a breakdown needs (a subset of a bill item). */
export interface BreakdownLine {
  category: string | null;
  gst_rate_bp: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  total_paise: number;
}

export interface CategoryGroup<L> {
  /** "" when the bill is not grouped (anything but a final bill). */
  name: string;
  items: L[];
  total_paise: number;
}

export interface RateRow {
  rate_bp: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
}

/**
 * Where a bill's money comes from, the same on screen and on paper.
 * - groups: a final bill's lines by category (first-seen order), each with its subtotal; other bills
 *   are one ungrouped group. A line with no category goes under `otherLabel`.
 * - byRate: GST by rate, lowest rate first; tax-free lines are left out.
 */
export function billBreakdown<L extends BreakdownLine>(items: L[], opts: { grouped: boolean; otherLabel: string }) {
  const groups = new Map<string, CategoryGroup<L>>();
  for (const i of items) {
    const name = opts.grouped ? (i.category ?? opts.otherLabel) : "";
    const g = groups.get(name) ?? { name, items: [], total_paise: 0 };
    g.items.push(i);
    g.total_paise += i.total_paise;
    groups.set(name, g);
  }
  const rates = new Map<number, RateRow>();
  for (const i of items) {
    if (i.cgst_paise + i.sgst_paise === 0) continue;
    const r = rates.get(i.gst_rate_bp) ?? { rate_bp: i.gst_rate_bp, taxable_paise: 0, cgst_paise: 0, sgst_paise: 0 };
    r.taxable_paise += i.taxable_paise;
    r.cgst_paise += i.cgst_paise;
    r.sgst_paise += i.sgst_paise;
    rates.set(i.gst_rate_bp, r);
  }
  return { groups: [...groups.values()], byRate: [...rates.values()].sort((a, b) => a.rate_bp - b.rate_bp) };
}
