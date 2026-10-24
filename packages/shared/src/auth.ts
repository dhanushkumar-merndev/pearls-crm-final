import { z } from "zod";

/**
 * Every staff member logs in with a USERNAME and password (owner's rule, 24/10/2026):
 * no email logins, no email codes, no email reset links. Admins create accounts and
 * reset passwords. Supabase Auth still needs an email under the hood, so a username
 * maps to "<username>@staff.invalid" (".invalid" is a reserved domain: nothing is ever
 * delivered there). A staff member's real email, if any, is only a contact detail.
 */
export const STAFF_EMAIL_DOMAIN = "staff.invalid";

/** 3–32 characters: lower-case letters, digits, dot, underscore, hyphen. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUsername(input: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(input));
}

/**
 * The login form is checked before anything is sent: an empty field or a username no
 * account could have never reaches Supabase. Messages are keys under `login` in
 * messages/en.json. The password is not trimmed and not held to the "new password"
 * rules here — any non-empty value is passed on as typed.
 */
export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { error: "usernameRequired", abort: true })
    .regex(USERNAME_PATTERN, { error: "usernameInvalid" }),
  password: z.string().min(1, { error: "passwordRequired" }),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** The hidden Supabase Auth address for a username. */
export function toLoginEmail(username: string): string {
  return `${normalizeUsername(username)}@${STAFF_EMAIL_DOMAIN}`;
}

export function isUsernameLogin(email: string): boolean {
  return email.toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}

/** New passwords (same rule as supabase/config.toml and the admin-users function): 8–72 characters, a letter and a digit. */
export const PASSWORD_MIN = 8;
export const newPasswordRule = () =>
  z
    .string({ error: "required" })
    .min(1, { error: "required", abort: true })
    .min(PASSWORD_MIN, { error: "passwordShort", abort: true })
    .max(72, { error: "tooLong" })
    .regex(/[A-Za-z]/, { error: "account.weak" })
    .regex(/[0-9]/, { error: "account.weak" });

/** A staff member changing their own password (user menu → Change password). */
export const changePasswordSchema = z
  .object({
    current: z.string().min(1, { error: "required" }),
    next: newPasswordRule(),
    again: z.string(),
  })
  .refine((d) => d.next === d.again, { path: ["again"], error: "passwordMismatch" });
