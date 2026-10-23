import { describe, expect, it } from "vitest";
import { isUsernameLogin, isValidUsername, toLoginEmail } from "../src/auth";

describe("username logins", () => {
  it("maps a username to the reserved internal domain (trimmed, lower-case)", () => {
    expect(toLoginEmail("  Reception2 ")).toBe("reception2@staff.invalid");
    expect(isUsernameLogin(toLoginEmail("reception2"))).toBe(true);
    expect(isUsernameLogin("rekha@example.com")).toBe(false);
  });

  it("accepts only simple usernames", () => {
    expect(isValidUsername("asha.admin")).toBe(true);
    expect(isValidUsername("Rekha_2")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("rekha@example.com")).toBe(false);
    expect(isValidUsername("has space")).toBe(false);
  });
});
