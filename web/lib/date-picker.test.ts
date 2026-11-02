import { describe, expect, it } from "vitest";
import {
  dateToIso,
  displayDate,
  displayDateTime,
  displayMonth,
  displayTime,
  isIsoDateString,
  isoToDate,
  joinDateTime,
  matchQuickRange,
  orderRange,
  quickRange,
  splitDateTime,
  timeOptions,
} from "./date-picker";

// 02/11/2026 10:00 IST
const NOW = new Date("2026-11-02T04:30:00Z");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

describe("date strings", () => {
  it("round-trips a calendar day without shifting it", () => {
    for (const v of ["2026-01-01", "2026-02-28", "2024-02-29", "2026-03-01", "2026-12-31"]) {
      expect(dateToIso(isoToDate(v)!)).toBe(v);
    }
  });
  it("refuses impossible days", () => {
    expect(isIsoDateString("2026-02-30")).toBe(false);
    expect(isIsoDateString("2026-13-01")).toBe(false);
    expect(isoToDate("")).toBeUndefined();
    expect(isoToDate("02/11/2026")).toBeUndefined();
  });
  it("shows DD/MM/YYYY and 12-hour time", () => {
    expect(displayDate("2026-11-02")).toBe("02/11/2026");
    expect(displayDate("")).toBe("");
    expect(displayTime("00:05")).toBe("12:05 AM");
    expect(displayTime("12:00")).toBe("12:00 PM");
    expect(displayTime("23:45")).toBe("11:45 PM");
    expect(displayTime("25:00")).toBe("");
    expect(displayDateTime("2026-11-02T14:05")).toBe("02/11/2026 2:05 PM");
  });
  it("splits and joins date + time", () => {
    expect(splitDateTime("2026-11-02T14:05")).toEqual({ date: "2026-11-02", time: "14:05" });
    expect(splitDateTime("")).toEqual({ date: "", time: "" });
    expect(joinDateTime("2026-11-02", "14:05")).toBe("2026-11-02T14:05");
    expect(joinDateTime("2026-11-02", "")).toBe("");
  });
  it("shows a month", () => {
    expect(displayMonth("2027-03", MONTHS)).toBe("Mar 2027");
    expect(displayMonth("2027-13", MONTHS)).toBe("");
  });
});

describe("time list", () => {
  it("steps through the day", () => {
    const list = timeOptions(15);
    expect(list).toHaveLength(96);
    expect(list[0]).toBe("00:00");
    expect(list.at(-1)).toBe("23:45");
  });
  it("keeps an off-step current value in order", () => {
    const list = timeOptions(30, "09:10");
    expect(list.indexOf("09:10")).toBe(list.indexOf("09:00") + 1);
  });
  it("trims to min / max", () => {
    expect(timeOptions(60, "", "09:00", "11:00")).toEqual(["09:00", "10:00", "11:00"]);
  });
});

describe("quick ranges (IST)", () => {
  it("computes each choice", () => {
    expect(quickRange("today", NOW)).toEqual({ from: "2026-11-02", to: "2026-11-02" });
    expect(quickRange("yesterday", NOW)).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(quickRange("last7", NOW)).toEqual({ from: "2026-10-27", to: "2026-11-02" });
    expect(quickRange("last30", NOW)).toEqual({ from: "2026-10-04", to: "2026-11-02" });
    expect(quickRange("thisMonth", NOW)).toEqual({ from: "2026-11-01", to: "2026-11-02" });
    expect(quickRange("lastMonth", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("uses the IST day, not UTC", () => {
    // 01/03/2026 00:30 IST is still 28/02 in UTC.
    const early = new Date("2026-02-28T19:00:00Z");
    expect(quickRange("today", early).from).toBe("2026-03-01");
    expect(quickRange("yesterday", early).from).toBe("2026-02-28");
    expect(quickRange("lastMonth", early)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("handles January → last December", () => {
    expect(quickRange("lastMonth", new Date("2027-01-10T06:00:00Z"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("recognises a quick choice", () => {
    expect(matchQuickRange("2026-10-27", "2026-11-02", NOW)).toBe("last7");
    expect(matchQuickRange("2026-10-26", "2026-11-02", NOW)).toBeNull();
  });
  it("orders a backwards pick", () => {
    expect(orderRange("2026-11-05", "2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-11-05" });
  });
});
