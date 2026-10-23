import { describe, expect, it } from "vitest";
import { ERROR_CODES, STAFF_ROLES, WEB_ROLES } from "@pearl/shared";
import messages from "../messages/en.json" with { type: "json" };
import { greetingKey } from "./greeting";
import { isActive, navFor, PRIMARY_ACTIONS } from "./nav";
import { isStrongEnough } from "./password";
import { isPublicPath } from "./supabase/proxy";

describe("menus per role", () => {
  it("every web role has Home; mobile roles have no web menu", () => {
    for (const role of WEB_ROLES) expect(navFor(role).map((i) => i.href)).toContain("/home");
    expect(navFor("sales_executive")).toEqual([]);
    expect(navFor("bdm")).toEqual([]);
  });

  it("only admins see the design preview", () => {
    for (const role of STAFF_ROLES) {
      expect(navFor(role).some((i) => i.href === "/design")).toBe(role === "admin");
    }
  });

  it("every menu label and primary action has a translation", () => {
    const has = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages);
    for (const role of STAFF_ROLES) {
      for (const item of navFor(role)) expect(has(item.labelKey), item.labelKey).toBeTypeOf("string");
      const action = PRIMARY_ACTIONS[role];
      if (action) expect(has(action.labelKey), action.labelKey).toBeTypeOf("string");
    }
  });

  it("marks the current page and its sub-pages active", () => {
    expect(isActive("/home", "/home")).toBe(true);
    expect(isActive("/patients/123", "/patients")).toBe(true);
    expect(isActive("/patientsx", "/patients")).toBe(false);
  });
});

describe("translations", () => {
  it("every error code the server can send has a friendly message", () => {
    for (const code of ERROR_CODES) expect(messages.errors[code], code).toBeTypeOf("string");
    expect(messages.errors.unknown).toBeTypeOf("string");
  });

  it("every role has a display name", () => {
    for (const role of STAFF_ROLES) expect(messages.roles[role]).toBeTypeOf("string");
  });
});

describe("login redirects", () => {
  it("lets logged-out visitors open only the public pages", () => {
    for (const p of ["/login", "/forgot-password", "/reset-password", "/auth/callback", "/api/keepalive"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
    for (const p of ["/", "/home", "/design", "/loginx", "/api/other", "/use-the-app"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});

describe("small helpers", () => {
  it("password rule matches the server (8+, letters and digits)", () => {
    expect(isStrongEnough("Pearl2026")).toBe(true);
    expect(isStrongEnough("short1")).toBe(false);
    expect(isStrongEnough("lettersonly")).toBe(false);
    expect(isStrongEnough("12345678")).toBe(false);
  });

  it("greets by IST hour", () => {
    expect(greetingKey(9)).toBe("morning");
    expect(greetingKey(12)).toBe("afternoon");
    expect(greetingKey(18)).toBe("evening");
  });
});
