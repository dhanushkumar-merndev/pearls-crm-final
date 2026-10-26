import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPE_LIST, NOTIFICATION_TYPES, SYSTEM_NOTIFICATION_TYPES } from "../src/notifications";

describe("notification types", () => {
  it("are database-safe names", () => {
    for (const type of [...NOTIFICATION_TYPE_LIST, ...SYSTEM_NOTIFICATION_TYPES]) expect(type).toMatch(/^[a-z_]+$/);
  });

  it("storage and backup warnings email the admin by default; the rest only ring the phone", () => {
    expect(NOTIFICATION_TYPES.storage_alert.email).toBe(true);
    expect(NOTIFICATION_TYPES.backup_reminder.email).toBe(true);
    expect(NOTIFICATION_TYPES.lead_assigned).toEqual({ push: true, email: false });
  });

  it("locate_now is a command to the phone, not something to switch off", () => {
    expect(NOTIFICATION_TYPE_LIST).not.toContain("locate_now");
  });
});
