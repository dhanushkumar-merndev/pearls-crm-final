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

/** The hidden Supabase Auth address for a username. */
export function toLoginEmail(username: string): string {
  return `${normalizeUsername(username)}@${STAFF_EMAIL_DOMAIN}`;
}

export function isUsernameLogin(email: string): boolean {
  return email.toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}
