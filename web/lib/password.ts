/** Same rule as supabase/config.toml and the admin-users function: 8+ characters, letters and digits. */
export function isStrongEnough(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
