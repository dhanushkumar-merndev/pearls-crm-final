import { describe, expect, it } from "vitest";
import { toErrorCode } from "../src/errors";

describe("toErrorCode", () => {
  it("passes our RPC codes through", () => {
    expect(toErrorCode({ code: "P0001", message: "slot_full_unknown" })).toBe("unknown");
    expect(toErrorCode({ code: "P0001", message: "stale_version" })).toBe("stale_version");
    expect(toErrorCode("not_allowed")).toBe("not_allowed");
  });

  it("maps Postgres constraint errors from direct admin writes", () => {
    expect(toErrorCode({ code: "23P01", message: "conflicting key value violates exclusion constraint" })).toBe("overlap");
    expect(toErrorCode({ code: "23505", message: "duplicate key" })).toBe("duplicate");
    expect(toErrorCode({ code: "23503", message: "violates foreign key" })).toBe("in_use");
    expect(toErrorCode({ code: "42501", message: "new row violates row-level security policy" })).toBe("not_allowed");
  });

  it("falls back to unknown", () => {
    expect(toErrorCode(null)).toBe("unknown");
    expect(toErrorCode(new Error("boom"))).toBe("unknown");
    expect(toErrorCode({ code: "XX000", message: "internal" })).toBe("unknown");
  });
});
