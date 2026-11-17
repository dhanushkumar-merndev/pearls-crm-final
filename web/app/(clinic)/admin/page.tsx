import {
  BedDouble,
  Bell,
  BookOpen,
  Building2,
  Goal,
  HardDrive,
  MapPin,
  FileInput,
  FileText,
  Megaphone,
  MessageCircle,
  Repeat,
  PackageOpen,
  CalendarOff,
  ClipboardList,
  History,
  Inbox,
  ListChecks,
  Pill,
  Settings,
  Stethoscope,
  Syringe,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Admin" };

type AdminLink = { href: string; key: string; icon: LucideIcon };

/** The admin pages in groups (Mary, 16/11/2026: "where do I add a doctor / a service?"). */
const GROUPS: { key: string; links: AdminLink[] }[] = [
  {
    key: "clinicStaff",
    links: [
      { href: "/admin/clinic", key: "clinic", icon: Building2 },
      { href: "/admin/users", key: "users", icon: Users },
      { href: "/admin/libraries/holidays", key: "holidays", icon: CalendarOff },
      { href: "/admin/libraries/offices", key: "offices", icon: MapPin },
    ],
  },
  {
    key: "doctorsServices",
    links: [
      { href: "/admin/libraries/doctors", key: "doctors", icon: Stethoscope },
      { href: "/admin/libraries/services", key: "services", icon: Syringe },
      { href: "/admin/libraries/treatments", key: "treatments", icon: ClipboardList },
      { href: "/admin/libraries/rooms", key: "rooms", icon: BedDouble },
      { href: "/admin/libraries/medicines", key: "medicines", icon: Pill },
    ],
  },
  {
    key: "billingDocs",
    links: [
      { href: "/admin/settings", key: "settings", icon: Settings },
      { href: "/admin/libraries/lists", key: "lists", icon: ListChecks },
      { href: "/admin/discharge-templates", key: "dischargeTemplates", icon: FileText },
    ],
  },
  {
    key: "salesMarketing",
    links: [
      { href: "/leads/import", key: "importLeads", icon: Target },
      { href: "/admin/meta-leads", key: "metaLeads", icon: Megaphone },
      { href: "/admin/whatsapp", key: "whatsapp", icon: MessageCircle },
      { href: "/admin/drips", key: "drips", icon: Repeat },
      { href: "/targets", key: "targets", icon: Goal },
    ],
  },
  {
    key: "dataSafety",
    links: [
      { href: "/admin/review", key: "review", icon: Inbox },
      { href: "/admin/import", key: "import", icon: FileInput },
      { href: "/admin/import?kind=stock", key: "importStock", icon: PackageOpen },
      { href: "/admin/backup", key: "backup", icon: HardDrive },
      { href: "/admin/notifications", key: "notifications", icon: Bell },
      { href: "/admin/audit", key: "audit", icon: History },
    ],
  },
];

function LinkCard({
  href,
  title,
  body,
  icon: Icon,
}: {
  href: string;
  title: string;
  body: string;
  icon: LucideIcon;
}) {
  return (
    <Link href={href} className="block h-full rounded-2xl focus-visible:outline-2">
      <Card className="flex h-full items-start gap-3 hover:bg-accent">
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
        <span>
          <span className="block text-[1.05rem] font-semibold">{title}</span>
          <span className="block text-[0.95rem] text-text-secondary">{body}</span>
        </span>
      </Card>
    </Link>
  );
}

export default async function AdminHome() {
  const t = await getTranslations("adminHub");
  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="max-w-xl">
        <LinkCard
          href="/admin/guide"
          title={t("guide.title")}
          body={t("guide.body")}
          icon={BookOpen}
        />
      </div>
      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`admin-${g.key}`} className="flex flex-col gap-3">
          <h2 id={`admin-${g.key}`} className="text-lg font-semibold">
            {t(`groups.${g.key}`)}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.links.map(({ href, key, icon }) => (
              <li key={href}>
                <LinkCard
                  href={href}
                  title={t(`${key}.title`)}
                  body={t(`${key}.body`)}
                  icon={icon}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Page>
  );
}
