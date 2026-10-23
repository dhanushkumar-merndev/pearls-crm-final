import { describe, expect, it } from "vitest";
import { divRound, formatINR, formatINRShort, groupIndian, rupeesToPaise } from "../src/money";

describe("divRound (half away from zero)", () => {
  it.each([
    [5n, 10n, 1n],
    [4n, 10n, 0n],
    [15n, 10n, 2n],
    [-5n, 10n, -1n],
    [-15n, 10n, -2n],
    [0n, 7n, 0n],
  ])("%d / %d = %d", (n, d, q) => {
    expect(divRound(n, d)).toBe(q);
  });

  it("refuses division by zero", () => {
    expect(() => divRound(1n, 0n)).toThrow("division_by_zero");
  });
});

describe("formatINR", () => {
  it.each([
    [0, "₹0.00"],
    [5, "₹0.05"],
    [79800, "₹798.00"],
    [15000000, "₹1,50,000.00"],
    [15000050, "₹1,50,000.50"],
    [1234567800, "₹1,23,45,678.00"],
    [-50000, "-₹500.00"],
  ])("%d paise → %s", (paise, text) => {
    expect(formatINR(paise)).toBe(text);
  });

  it("can drop the symbol and zero paise", () => {
    expect(formatINR(15000000, { symbol: false, decimals: false })).toBe("1,50,000");
    expect(formatINR(15000050, { decimals: false })).toBe("₹1,50,000.50");
  });

  it("rejects non-integer paise", () => {
    expect(() => formatINR(10.5)).toThrow("amount_not_integer_paise");
  });
});

describe("formatINRShort", () => {
  it.each([
    [79800, "₹798"],
    [1250000, "₹12.5K"],
    [15000000, "₹1.5L"],
    [99000000, "₹9.9L"],
    [99950000, "₹10L"],
    [250000000, "₹25L"],
    [2500000000, "₹2.5Cr"],
    [-15000000, "-₹1.5L"],
  ])("%d paise → %s", (paise, text) => {
    expect(formatINRShort(paise)).toBe(text);
  });
});

describe("groupIndian", () => {
  it.each([
    ["1", "1"],
    ["999", "999"],
    ["1000", "1,000"],
    ["100000", "1,00,000"],
    ["10000000", "1,00,00,000"],
  ])("%s → %s", (digits, grouped) => {
    expect(groupIndian(digits)).toBe(grouped);
  });
});

describe("rupeesToPaise", () => {
  it.each([
    ["1,50,000", 15000000],
    ["₹ 1,50,000.5", 15000050],
    ["0.05", 5],
    [798, 79800],
    ["-500", -50000],
  ])("%s → %d", (input, paise) => {
    expect(rupeesToPaise(input)).toBe(paise);
  });

  it.each(["", "abc", "1.234", "1..2"])("rejects %s", (input) => {
    expect(() => rupeesToPaise(input)).toThrow("invalid_amount");
  });
});
