import { describe, expect, it } from "vitest";
import {
  emptyBreakdownLine,
  gstIncluded,
  lineFromRow,
  linesTotal,
  moveLine,
  splitLine,
  toBreakdownPayload,
  withAmount,
  withQtyOrRate,
  type BreakdownEditLine,
} from "./breakdown-bill";

const line = (description: string, amount: number, extra: Partial<BreakdownEditLine> = {}): BreakdownEditLine => ({
  ...emptyBreakdownLine(),
  description,
  amount_paise: amount,
  unit_paise: amount,
  ...extra,
});

describe("breakdown bill lines", () => {
  it("splits a package into two lines without changing the total", () => {
    const lines = [line("Package", 10_000_001, { category: { id: "c1", label: "Procedure" }, service_date: "2026-11-08" }), line("Room", 300_000)];
    const out = splitLine(lines, lines[0]!.key);
    expect(out).toHaveLength(3);
    expect(out.map((l) => l.amount_paise)).toEqual([5_000_001, 5_000_000, 300_000]);
    expect(linesTotal(out)).toBe(linesTotal(lines));
    // The new line sits right under it, same category and date, waiting for a name.
    expect(out[1]).toMatchObject({ description: "", category: { id: "c1" }, service_date: "2026-11-08" });
  });

  it("moves a line up and down, and not past the ends", () => {
    const lines = [line("A", 1), line("B", 2), line("C", 3)];
    expect(moveLine(lines, lines[2]!.key, -1).map((l) => l.description)).toEqual(["A", "C", "B"]);
    expect(moveLine(lines, lines[0]!.key, -1)).toBe(lines);
    expect(moveLine(lines, lines[2]!.key, 1)).toBe(lines);
  });

  it("amount = qty × rate; typing an amount moves the rate", () => {
    const l = withQtyOrRate(line("Dressing", 0), { qty: "3", unit_paise: 33_333 });
    expect(l.amount_paise).toBe(99_999);
    const typed = withAmount(l, 120_000);
    expect(typed).toMatchObject({ amount_paise: 120_000, unit_paise: 40_000 });
  });

  it("reads a stored line and writes the save payload", () => {
    const l = lineFromRow({
      id: "x", line_no: 1, category_id: "c1", category: "Room charges", description: " Room ", service_date: null,
      qty: "2.000", unit_paise: 150_000, gst_rate_bp: 0, amount_paise: 300_000, source_bill_item_id: "i1",
    });
    expect(l).toMatchObject({ qty: "2", service_date: "", category: { id: "c1", label: "Room charges" } });
    expect(toBreakdownPayload(l)).toEqual({
      category_id: "c1", description: "Room", service_date: null, qty: 2, unit_paise: 150_000, gst_rate_bp: 0,
      amount_paise: 300_000, source_bill_item_id: "i1",
    });
  });

  it("works out the GST inside the amounts, by rate", () => {
    const rows = gstIncluded([
      { gst_rate_bp: 1800, amount_paise: 118_000 },
      { gst_rate_bp: 0, amount_paise: 50_000 },
      { gst_rate_bp: 500, amount_paise: 10_500 },
      { gst_rate_bp: 1800, amount_paise: 11_800 },
    ]);
    expect(rows).toEqual([
      { rate_bp: 500, taxable_paise: 10_000, cgst_paise: 250, sgst_paise: 250 },
      { rate_bp: 1800, taxable_paise: 110_000, cgst_paise: 9_900, sgst_paise: 9_900 },
    ]);
  });
});
