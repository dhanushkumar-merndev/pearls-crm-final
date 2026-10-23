/**
 * Staff without an email address log in with a username. Supabase Auth needs an
 * email, so a username maps to "<username>@staff.invalid" (".invalid" is a
 * reserved domain: nothing is ever delivered there). Admins reset their passwords.
 */
export const STAFF_EMAIL_DOMAIN = "staff.invalid";

export function toLoginEmail(identifier: string): string {
  const value = identifier.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@${STAFF_EMAIL_DOMAIN}`;
}

export function isUsernameLogin(email: string): boolean {
  return email.toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}
