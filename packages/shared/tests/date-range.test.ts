import { describe, expect, it } from "vitest";
import { ADS_MAX_RANGE_DAYS, adsDateRangeSchema, dateRangeSchema } from "../src";

const message = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe("date range filters", () => {
  it("sales tables: at most a year, end after start", () => {
    expect(dateRangeSchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
    expect(message(dateRangeSchema.safeParse({ from: "2024-01-28", to: "2026-10-31" }))).toBe("rangeTooLong");
    expect(message(dateRangeSchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }))).toBe("dateOrder");
  });

  it("the Ads page: up to 24 months, with its own message", () => {
    expect(adsDateRangeSchema.safeParse({ from: "2024-11-01", to: "2026-10-31" }).success).toBe(true);
    expect(message(adsDateRangeSchema.safeParse({ from: "2024-01-28", to: "2026-10-31" }))).toBe("rangeTooLongAds");
    const last = new Date(Date.parse("2026-10-31") - ADS_MAX_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(adsDateRangeSchema.safeParse({ from: last, to: "2026-10-31" }).success).toBe(true);
    expect(message(adsDateRangeSchema.safeParse({ from: "2023-01-01", to: "2026-10-31" }))).toBe("rangeTooLongAds");
    expect(message(adsDateRangeSchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }))).toBe("dateOrder");
  });
});
