import {
  BedDouble, Bell, Building2, Goal, HardDrive, MapPin, FileInput, FileText, Megaphone, MessageCircle, Repeat, PackageOpen, CalendarOff, ClipboardList, History, Inbox, ListChecks, Pill, Settings,
  Stethoscope, Syringe, Target, Users, type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/form";

export const metadata: Metadata = { title: "Admin" };

const LINKS: { href: string; key: string; icon: LucideIcon }[] = [
  { href: "/admin/clinic", key: "clinic", icon: Building2 },
  { href: "/admin/users", key: "users", icon: Users },
  { href: "/admin/libraries/doctors", key: "doctors", icon: Stethoscope },
  { href: "/admin/libraries/holidays", key: "holidays", icon: CalendarOff },
  { href: "/admin/libraries/offices", key: "offices", icon: MapPin },
  { href: "/admin/settings", key: "settings", icon: Settings },
  { href: "/admin/libraries/services", key: "services", icon: Syringe },
  { href: "/admin/libraries/treatments", key: "treatments", icon: ClipboardList },
  { href: "/admin/libraries/rooms", key: "rooms", icon: BedDouble },
  { href: "/admin/libraries/medicines", key: "medicines", icon: Pill },
  { href: "/admin/libraries/lists", key: "lists", icon: ListChecks },
  { href: "/admin/discharge-templates", key: "dischargeTemplates", icon: FileText },
  { href: "/admin/review", key: "review", icon: Inbox },
  { href: "/admin/import", key: "import", icon: FileInput },
  { href: "/admin/import?kind=stock", key: "importStock", icon: PackageOpen },
  { href: "/leads/import", key: "importLeads", icon: Target },
  { href: "/admin/meta-leads", key: "metaLeads", icon: Megaphone },
  { href: "/admin/whatsapp", key: "whatsapp", icon: MessageCircle },
  { href: "/admin/drips", key: "drips", icon: Repeat },
  { href: "/admin/backup", key: "backup", icon: HardDrive },
  { href: "/admin/notifications", key: "notifications", icon: Bell },
  { href: "/targets", key: "targets", icon: Goal },
  { href: "/admin/audit", key: "audit", icon: History },
];

export default async function AdminHome() {
  const t = await getTranslations("adminHub");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map(({ href, key, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="block h-full rounded-2xl focus-visible:outline-2">
              <Card className="flex h-full items-start gap-3 hover:bg-accent">
                <Icon aria-hidden className="mt-0.5 size-6 shrink-0 text-text-secondary" />
                <span>
                  <span className="block text-lg font-semibold">{t(`${key}.title`)}</span>
                  <span className="block text-[0.95rem] text-text-secondary">{t(`${key}.body`)}</span>
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
