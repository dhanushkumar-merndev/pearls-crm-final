import { describe, expect, it } from "vitest";
import { pct, rangeFor } from "./periods";

describe("dashboard periods (IST)", () => {
  // 26/10/2026 10:00 IST
  const now = new Date("2026-10-26T04:30:00Z");
  it("today, 7 days, month to date", () => {
    expect(rangeFor("today", now)).toEqual({ from: "2026-10-26", to: "2026-10-26" });
    expect(rangeFor("7d", now)).toEqual({ from: "2026-10-20", to: "2026-10-26" });
    expect(rangeFor("mtd", now)).toEqual({ from: "2026-10-01", to: "2026-10-26" });
  });
  it("last month, across a year end", () => {
    expect(rangeFor("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(rangeFor("lastMonth", new Date("2027-01-10T04:30:00Z"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("1:30 AM IST on the 1st is already the new month", () => {
    expect(rangeFor("mtd", new Date("2026-10-31T20:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });
  it("percentages", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(5, 0)).toBe(0);
  });
});
