import {
  BookOpen,
  ReceiptIndianRupee,
  Stethoscope,
  Syringe,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "How to set up and use" };

/** Mary's questions (16/11/2026), answered in the app: doctors, services, the four billing sections, the money boxes. */
const SECTIONS: { key: string; icon: LucideIcon; links: { href: string; key: string }[] }[] = [
  {
    key: "doctor",
    icon: Stethoscope,
    links: [{ href: "/admin/libraries/doctors", key: "doctors" }],
  },
  {
    key: "service",
    icon: Syringe,
    links: [
      { href: "/admin/libraries/services", key: "services" },
      { href: "/admin/libraries/treatments", key: "treatments" },
      { href: "/admin/libraries/medicines", key: "medicines" },
      { href: "/admin/libraries/rooms", key: "rooms" },
    ],
  },
  { key: "billing", icon: ReceiptIndianRupee, links: [{ href: "/bills", key: "bills" }] },
  { key: "money", icon: Wallet, links: [] },
];

export default async function AdminGuidePage() {
  const t = await getTranslations("adminGuide");
  return (
    <Page>
      <PageHeader
        back={{ href: "/admin", label: t("back") }}
        title={t("title")}
        description={t("description")}
      />
      <nav aria-label={t("contents")}>
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <a
                href={`#${s.key}`}
                className="inline-flex min-h-9 items-center rounded-full border border-border px-3 hover:bg-accent focus-visible:outline-2"
              >
                {t(`${s.key}.title`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {SECTIONS.map(({ key, icon: Icon, links }) => {
        const steps = t.raw(`${key}.steps`) as string[];
        return (
          <section key={key} id={key} aria-labelledby={`guide-${key}`} className="scroll-mt-16">
            <Card className="flex flex-col gap-3">
              <CardTitle id={`guide-${key}`} className="flex items-center gap-2">
                <Icon aria-hidden className="size-5 text-text-secondary" />
                {t(`${key}.title`)}
              </CardTitle>
              <p className="max-w-prose text-text-secondary">{t(`${key}.intro`)}</p>
              <ol className="flex max-w-prose list-decimal flex-col gap-2 pl-5">
                {steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {links.length > 0 && (
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  {links.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="inline-flex min-h-8 items-center gap-1 text-link underline-offset-4 hover:underline"
                    >
                      <BookOpen aria-hidden className="size-4" />
                      {t(`links.${l.key}`)}
                    </Link>
                  ))}
                </p>
              )}
            </Card>
          </section>
        );
      })}
    </Page>
  );
}
