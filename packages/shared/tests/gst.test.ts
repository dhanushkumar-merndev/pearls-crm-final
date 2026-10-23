import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/gst.json" with { type: "json" };
import { computeBillTotals, computeLine, type LineInput } from "../src/gst";

describe("computeLine — golden vectors", () => {
  it.each(vectors.lines)("$name", ({ input, expect: expected }) => {
    expect(computeLine(input as LineInput)).toEqual(expected);
  });

  it.each(vectors.errors)("$name → $error", ({ input, error }) => {
    expect(() => computeLine(input as LineInput)).toThrow(error);
  });
});

describe("computeLine — invariants", () => {
  // Deterministic pseudo-random inputs so failures are reproducible.
  let seed = 42;
  const rand = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % max;
  };
  const rates = [0, 500, 1200, 1800, 2800];

  it("holds for 5,000 random lines", () => {
    for (let i = 0; i < 5000; i++) {
      const ratePaise = rand(10_000_000);
      const qtyMilli = 1 + rand(50_000);
      const percent = rand(2) === 0;
      const input: LineInput = {
        ratePaise,
        qtyMilli,
        discountType: percent ? "percent" : "amount",
        discountValue: percent ? rand(10_001) : 0,
        gstRateBp: rates[rand(rates.length)]!,
        taxInclusive: rand(2) === 0,
      };
      const r = computeLine(input);
      expect(r.cgstPaise + r.sgstPaise).toBe(r.taxPaise);
      expect(r.sgstPaise - r.cgstPaise).toBeGreaterThanOrEqual(0);
      expect(r.sgstPaise - r.cgstPaise).toBeLessThanOrEqual(1);
      expect(r.totalPaise).toBe(r.taxablePaise + r.taxPaise);
      expect(r.discountPaise).toBeLessThanOrEqual(r.grossPaise);
      if (input.taxInclusive) expect(r.totalPaise).toBe(r.grossPaise - r.discountPaise);
    }
  });
});

describe("computeBillTotals", () => {
  const a = computeLine(vectors.lines[0]!.input as LineInput); // 11800
  const b = computeLine(vectors.lines[3]!.input as LineInput); // 1155

  it("sums lines", () => {
    const t = computeBillTotals([a, b]);
    expect(t.totalPaise).toBe(12955);
    expect(t.cgstPaise + t.sgstPaise).toBe(t.taxPaise);
    expect(t.roundOffPaise).toBe(0);
    expect(t.payablePaise).toBe(12955);
  });

  it("rounds to the nearest rupee as a separate line when asked", () => {
    const t = computeBillTotals([a, b], true); // ₹129.55 → ₹130
    expect(t.roundOffPaise).toBe(45);
    expect(t.payablePaise).toBe(13000);
  });
});
