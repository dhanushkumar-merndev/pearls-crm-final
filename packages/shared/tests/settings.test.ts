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

  it("sales: recordings upload only when asked, first 10 minutes", () => {
    const s = readSettings("sales", {});
    expect(s.recording_upload_mode).toBe("sync_only");
    expect(s.recording_max_minutes).toBe(10);
    expect(validateSettings("sales", { recording_upload_mode: "everything" })).toEqual({ ok: false, field: "recording_upload_mode" });
    expect(validateSettings("sales", { recording_max_minutes: 0 })).toEqual({ ok: false, field: "recording_max_minutes" });
    expect(validateSettings("sales", { recording_upload_mode: "all_calls", recording_max_minutes: 60 }).ok).toBe(true);
  });

  it("whatsapp: off until switched on, quiet hours 21:00–09:00 IST", () => {
    const w = readSettings("whatsapp", {});
    expect(w.enabled).toBe(false);
    expect([w.quiet_start, w.quiet_end]).toEqual(["21:00", "09:00"]);
    expect(w.cost_utility_paise).toBe(12);
    expect(w.stop_reply).toBeNull();
    expect(validateSettings("whatsapp", { quiet_start: "25:00" })).toEqual({ ok: false, field: "quiet_start" });
    expect(validateSettings("whatsapp", { cost_marketing_paise: -1 })).toEqual({ ok: false, field: "cost_marketing_paise" });
    expect(validateSettings("whatsapp", { stop_reply: "x".repeat(1001) })).toEqual({ ok: false, field: "stop_reply" });
    // Overnight and equal times are both fine (equal = no quiet hours).
    expect(validateSettings("whatsapp", { quiet_start: "09:00", quiet_end: "09:00" }).ok).toBe(true);
  });
});
