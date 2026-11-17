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

/** Roles that use the web app. BDMs work on Android; sales executives use both (the web gives them the sales sheet). */
export const WEB_ROLES: readonly StaffRole[] = ["receptionist", "sales_executive", "sales_manager", "admin"];

export type ThemePreference = "dark" | "light" | "system";
