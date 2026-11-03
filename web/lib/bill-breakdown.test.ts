import { describe, expect, it } from "vitest";
import { billBreakdown, type BreakdownLine } from "./bill-breakdown";

const line = (category: string | null, rate: number, taxable: number, gst: number, total: number): BreakdownLine => ({
  category,
  gst_rate_bp: rate,
  taxable_paise: taxable,
  cgst_paise: gst / 2,
  sgst_paise: gst / 2,
  total_paise: total,
});

describe("bill breakdown", () => {
  const items = [
    line("Room", 0, 300000, 0, 300000),
    line("Pharmacy", 1200, 10000, 1200, 11200),
    line("Room", 0, 150000, 0, 150000),
    line(null, 500, 20000, 1000, 21000),
    line("Pharmacy", 500, 4000, 200, 4200),
  ];

  it("a final bill groups by category in first-seen order, with subtotals; no category is 'Other'", () => {
    const { groups } = billBreakdown(items, { grouped: true, otherLabel: "Other" });
    expect(groups.map((g) => [g.name, g.items.length, g.total_paise])).toEqual([
      ["Room", 2, 450000],
      ["Pharmacy", 2, 15400],
      ["Other", 1, 21000],
    ]);
    // Subtotals add up to the lines.
    expect(groups.reduce((s, g) => s + g.total_paise, 0)).toBe(items.reduce((s, i) => s + i.total_paise, 0));
  });

  it("other bills are one ungrouped group", () => {
    const { groups } = billBreakdown(items, { grouped: false, otherLabel: "Other" });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("");
    expect(groups[0]?.items).toHaveLength(5);
  });

  it("GST by rate, lowest first, tax-free lines left out", () => {
    const { byRate } = billBreakdown(items, { grouped: true, otherLabel: "Other" });
    expect(byRate).toEqual([
      { rate_bp: 500, taxable_paise: 24000, cgst_paise: 600, sgst_paise: 600 },
      { rate_bp: 1200, taxable_paise: 10000, cgst_paise: 600, sgst_paise: 600 },
    ]);
  });

  it("an empty bill has no groups and no GST rows", () => {
    expect(billBreakdown([], { grouped: true, otherLabel: "Other" })).toEqual({ groups: [], byRate: [] });
  });
});
