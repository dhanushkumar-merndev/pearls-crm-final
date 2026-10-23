import { describe, expect, it } from "vitest";
import { isUsernameLogin, toLoginEmail } from "../src/auth";

describe("toLoginEmail", () => {
  it("keeps real email addresses (trimmed, lower-case)", () => {
    expect(toLoginEmail("  Rekha@Example.com ")).toBe("rekha@example.com");
  });

  it("maps a username to the reserved internal domain", () => {
    expect(toLoginEmail("Reception2")).toBe("reception2@staff.invalid");
    expect(isUsernameLogin(toLoginEmail("reception2"))).toBe(true);
    expect(isUsernameLogin("rekha@example.com")).toBe(false);
  });
});
