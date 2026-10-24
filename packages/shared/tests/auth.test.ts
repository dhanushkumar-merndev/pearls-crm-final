import { describe, expect, it } from "vitest";
import { isUsernameLogin, isValidUsername, loginSchema, toLoginEmail } from "../src/auth";

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

describe("login form check", () => {
  const messages = (input: { username: string; password: string }) => {
    const result = loginSchema.safeParse(input);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));
  };

  it("stops empty fields before anything is sent", () => {
    expect(messages({ username: "", password: "" })).toEqual({ username: "usernameRequired", password: "passwordRequired" });
    expect(messages({ username: "   ", password: "x" })).toEqual({ username: "usernameRequired" });
  });

  it("stops usernames no account could have", () => {
    expect(messages({ username: "rekha@example.com", password: "x" })).toEqual({ username: "usernameInvalid" });
    expect(messages({ username: "ab", password: "x" })).toEqual({ username: "usernameInvalid" });
  });

  it("passes a good login on, username tidied and password exactly as typed", () => {
    expect(loginSchema.parse({ username: " Reception2 ", password: " Pearl@2026 " })).toEqual({
      username: "reception2",
      password: " Pearl@2026 ",
    });
  });
});
