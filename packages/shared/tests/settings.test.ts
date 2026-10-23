import { describe, expect, it } from "vitest";
import { readSettings, validateSettings } from "../src/settings";

describe("settings", () => {
  it("fills defaults for a missing section (PLAN.md A2)", () => {
    const a = readSettings("appointments", null);
    expect(a.slot_minutes).toBe(15);
    expect(a.capacity_per_slot).toBe(3);
    expect(a.working_days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(readSettings("billing", {}).receptionist_max_discount_bp).toBe(2000);
  });

  it("keeps stored values and fills only what is missing", () => {
    expect(readSettings("appointments", { capacity_per_slot: 5 }).capacity_per_slot).toBe(5);
    expect(readSettings("appointments", { capacity_per_slot: 5 }).slot_minutes).toBe(15);
  });

  it("refuses bad values and names the field", () => {
    expect(validateSettings("appointments", { capacity_per_slot: 0 })).toEqual({ ok: false, field: "capacity_per_slot" });
    expect(validateSettings("appointments", { day_start: "20:00", day_end: "10:00" })).toEqual({ ok: false, field: "day_end" });
    expect(validateSettings("security", { idle_logout_minutes: 9999 })).toEqual({ ok: false, field: "idle_logout_minutes" });
    expect(validateSettings("billing", { ip_number_mode: "whatever" })).toEqual({ ok: false, field: "ip_number_mode" });
  });
});
