import { describe, expect, it } from "vitest";
import { cellText, isXlsx } from "./excel";

describe("Excel cells → import text", () => {
  it("keeps phone numbers whole", () => {
    expect(cellText(9845012345)).toBe("9845012345");
    expect(cellText(919845012345)).toBe("919845012345");
  });

  it("dates become YYYY-MM-DD (the import reads that format)", () => {
    expect(cellText(new Date(Date.UTC(1990, 2, 31)))).toBe("1990-03-31");
  });

  it("decimals, blanks, booleans and text", () => {
    expect(cellText(12.5)).toBe("12.5");
    expect(cellText(null)).toBe("");
    expect(cellText(true)).toBe("TRUE");
    expect(cellText("  Asha  ")).toBe("Asha");
    expect(cellText(Number.NaN)).toBe("");
  });

  it("only the modern Excel format is read; old .xls must be re-saved", () => {
    expect(isXlsx("patients.XLSX")).toBe(true);
    expect(isXlsx("patients.xls")).toBe(false);
    expect(isXlsx("patients.csv")).toBe(false);
  });
});
