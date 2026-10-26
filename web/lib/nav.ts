import { AudioLines, BedDouble, Car, CalendarDays, House, ListTodo, MessageCircle, Palette, Pill, Plus, ReceiptIndianRupee, Settings, Target, Users, type LucideIcon } from "lucide-react";
import type { StaffRole } from "@pearl/shared";

export interface NavItem {
  href: string;
  /** Key in messages/en.json */
  labelKey: string;
  icon: LucideIcon;
  roles: readonly StaffRole[];
  /** Key in nav_badges(): a count shown next to the label (e.g. open pharmacy alerts). */
  badge?: string;
  /** Screen-reader label with the count (default "nav.withCount", which says "alerts"). */
  badgeLabelKey?: string;
}

/** Menu items, in order. Each phase adds its pages here. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/home", labelKey: "nav.home", icon: House, roles: ["receptionist", "sales_manager", "admin"] },
  { href: "/leads", labelKey: "nav.leads", icon: Target, roles: ["sales_manager", "admin"], badge: "leads", badgeLabelKey: "nav.leadsWithCount" },
  {
    href: "/whatsapp",
    labelKey: "nav.whatsapp",
    icon: MessageCircle,
    roles: ["receptionist", "sales_manager", "admin"],
    badge: "whatsapp",
    badgeLabelKey: "nav.whatsappWithCount",
  },
  { href: "/bdm", labelKey: "nav.bdm", icon: Car, roles: ["admin"] },
  { href: "/recordings", labelKey: "nav.recordings", icon: AudioLines, roles: ["sales_manager", "admin"] },
  { href: "/appointments", labelKey: "nav.appointments", icon: CalendarDays, roles: ["receptionist", "admin"] },
  { href: "/patients", labelKey: "nav.patients", icon: Users, roles: ["receptionist", "admin"] },
  { href: "/admissions", labelKey: "nav.admissions", icon: BedDouble, roles: ["receptionist", "admin"] },
  { href: "/bills", labelKey: "nav.bills", icon: ReceiptIndianRupee, roles: ["receptionist", "admin"] },
  { href: "/pharmacy", labelKey: "nav.pharmacy", icon: Pill, roles: ["receptionist", "admin"], badge: "pharmacy" },
  { href: "/followups", labelKey: "nav.followups", icon: ListTodo, roles: ["receptionist", "admin"] },
  { href: "/admin", labelKey: "nav.admin", icon: Settings, roles: ["admin"] },
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
  receptionist: { labelKey: "actions.newPatient", icon: Plus, href: "/patients/new" },
  admin: { labelKey: "actions.newPatient", icon: Plus, href: "/patients/new" },
  sales_manager: { labelKey: "actions.newLead", icon: Plus, href: "/leads?new=1" },
};

export function navFor(role: StaffRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
