import { House, Palette, Plus, type LucideIcon } from "lucide-react";
import type { StaffRole } from "@pearl/shared";

export interface NavItem {
  href: string;
  /** Key in messages/en.json */
  labelKey: string;
  icon: LucideIcon;
  roles: readonly StaffRole[];
}

/** Menu items, in order. Each phase adds its pages here. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/home", labelKey: "nav.home", icon: House, roles: ["receptionist", "sales_manager", "admin"] },
  { href: "/design", labelKey: "nav.design", icon: Palette, roles: ["admin"] },
];

export interface PrimaryAction {
  labelKey: string;
  icon: LucideIcon;
  /** null until the page exists (shown disabled with "Coming soon"). */
  href: string | null;
}

/** The big button at the top of the sidebar (ChatGPT's "New chat" spot). */
export const PRIMARY_ACTIONS: Partial<Record<StaffRole, PrimaryAction>> = {
  receptionist: { labelKey: "actions.newPatient", icon: Plus, href: null },
  admin: { labelKey: "actions.newPatient", icon: Plus, href: null },
  sales_manager: { labelKey: "actions.newLead", icon: Plus, href: null },
};

export function navFor(role: StaffRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
