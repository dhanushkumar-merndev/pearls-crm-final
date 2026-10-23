import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/words.json" with { type: "json" };
import { amountInWords, numberToIndianWords } from "../src/words";

describe("amountInWords — golden vectors", () => {
  it.each(vectors.cases)("$paise paise → $words", ({ paise, words }) => {
    expect(amountInWords(paise)).toBe(words);
  });
});

describe("amountInWords — guards", () => {
  it("never produces the old final-bill mistake (₹1,50,000 ≠ One Lakh Thirty Thousand)", () => {
    expect(amountInWords(15000000)).not.toContain("Thirty");
  });

  it("rejects negative and fractional paise", () => {
    expect(() => amountInWords(-1)).toThrow("negative_amount");
    expect(() => amountInWords(1.5)).toThrow();
  });
});

describe("numberToIndianWords", () => {
  it("covers every number from 0 to 99 without gaps", () => {
    for (let n = 0; n < 100; n++) {
      expect(numberToIndianWords(n)).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)?$/);
    }
  });
});
