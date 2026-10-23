export const STAFF_ROLES = [
  "receptionist",
  "sales_executive",
  "sales_manager",
  "bdm",
  "admin",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Roles that use the web app. Sales executives and BDMs work on Android. */
export const WEB_ROLES: readonly StaffRole[] = ["receptionist", "sales_manager", "admin"];

export type ThemePreference = "dark" | "light" | "system";
