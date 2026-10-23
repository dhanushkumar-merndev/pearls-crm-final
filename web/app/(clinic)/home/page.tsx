import { CalendarDays, Palette } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDate, istParts } from "@pearl/shared";
import { TodayBoard } from "@/components/today/today-board";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { greetingKey } from "@/lib/greeting";
import { getMe } from "@/lib/session";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const [me, t] = await Promise.all([getMe(), getTranslations("home")]);
  const now = new Date();
  const firstName = me?.full_name.split(" ")[0] ?? "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.9rem] font-semibold tracking-tight">
          {t(`greeting.${greetingKey(istParts(now).hour)}`, { name: firstName })}
        </h1>
        <p className="mt-1 text-text-secondary">{t("todayIs", { date: formatDate(now) })}</p>
      </div>

      {me && (me.role === "receptionist" || me.role === "admin") ? (
        <TodayBoard />
      ) : (
        <Card className="flex flex-col items-start gap-3 py-10 sm:items-center sm:text-center">
          <CalendarDays aria-hidden className="size-10 text-text-secondary" />
          <CardTitle>{t("emptyTitle")}</CardTitle>
          <CardDescription className="max-w-prose">{t("emptyBody")}</CardDescription>
          {me?.role === "admin" && (
            <Button asChild variant="secondary" className="mt-2">
              <Link href="/design">
                <Palette aria-hidden />
                {t("designLink")}
              </Link>
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
