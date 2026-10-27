import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { formatDate, istParts } from "@pearl/shared";
import { SalesDashboard } from "@/components/sales/sales-dashboard";
import { TodayBoard } from "@/components/today/today-board";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { greetingKey } from "@/lib/greeting";
import { getMe } from "@/lib/session";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const [me, t] = await Promise.all([getMe(), getTranslations("home")]);
  const now = new Date();
  const firstName = me?.full_name.split(" ")[0] ?? "";

  return (
    <Page>
      <PageHeader
        title={t(`greeting.${greetingKey(istParts(now).hour)}`, { name: firstName })}
        description={t("todayIs", { date: formatDate(now) })}
      />

      {me && (me.role === "receptionist" || me.role === "admin") ? (
        <TodayBoard />
      ) : me?.role === "sales_manager" ? (
        <SalesDashboard />
      ) : (
        <Card className="flex flex-col items-start gap-3 py-10 sm:items-center sm:text-center">
          <CalendarDays aria-hidden className="size-10 text-text-secondary" />
          <CardTitle>{t("emptyTitle")}</CardTitle>
          <CardDescription className="max-w-prose">{t("emptyBody")}</CardDescription>
        </Card>
      )}
    </Page>
  );
}
