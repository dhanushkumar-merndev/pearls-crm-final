import { describe, expect, it } from "vitest";
import { fromIstDateTimeLocal, istDateTimeLocal } from "../src/dates";
import {
  financialYear,
  formatDate,
  formatDateTime,
  formatTime,
  istDateString,
  istDayStart,
} from "../src/dates";

describe("IST formatting", () => {
  it("shows IST date and 12-hour time", () => {
    expect(formatDateTime(new Date("2026-10-01T05:26:00Z"))).toBe("01/10/2026 10:56 AM");
    expect(formatTime(new Date("2026-10-01T06:30:00Z"))).toBe("12:00 PM");
    expect(formatTime(new Date("2026-10-01T18:30:00Z"))).toBe("12:00 AM");
  });

  it("rolls the date over at IST midnight, not UTC midnight", () => {
    const justAfterIstMidnight = new Date("2026-10-23T18:45:00Z"); // 24/10 00:15 IST
    expect(istDateString(justAfterIstMidnight)).toBe("2026-10-24");
    expect(formatDate(justAfterIstMidnight)).toBe("24/10/2026");
    const justBefore = new Date("2026-10-23T18:29:00Z"); // 23/10 23:59 IST
    expect(istDateString(justBefore)).toBe("2026-10-23");
  });

  it("finds the UTC instant of IST midnight", () => {
    expect(istDayStart("2026-10-24").toISOString()).toBe("2026-10-23T18:30:00.000Z");
    expect(() => istDayStart("24/10/2026")).toThrow("invalid_date");
  });
});

describe("financialYear (1 April, IST)", () => {
  it.each([
    ["2026-03-31T18:29:59Z", "2025-26", "25-26"], // 31/03/2026 23:59:59 IST
    ["2026-03-31T18:30:00Z", "2026-27", "26-27"], // 01/04/2026 00:00 IST
    ["2026-10-01T05:26:00Z", "2026-27", "26-27"],
    ["2027-01-15T06:00:00Z", "2026-27", "26-27"],
    ["2099-12-31T00:00:00Z", "2099-00", "99-00"],
  ])("%s → %s", (iso, label, short) => {
    const fy = financialYear(new Date(iso));
    expect(fy.label).toBe(label);
    expect(fy.short).toBe(short);
  });
});

describe("datetime-local inputs in IST", () => {
  it("shows an instant as IST wall time and reads it back", () => {
    expect(istDateTimeLocal(new Date("2026-03-30T05:20:00Z"))).toBe("2026-03-30T10:50");
    expect(fromIstDateTimeLocal("2026-03-30T10:50")).toBe("2026-03-30T05:20:00.000Z");
    expect(fromIstDateTimeLocal("2026-03-31T00:10")).toBe("2026-03-30T18:40:00.000Z");
    expect(fromIstDateTimeLocal("30/03/2026")).toBeNull();
  });
});
