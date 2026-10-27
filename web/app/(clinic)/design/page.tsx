import { CalendarPlus, NotebookPen, Trash2, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatINR } from "@pearl/shared";
import { StatTile } from "@/components/kpi/stat-tile";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { getMe } from "@/lib/session";
import { DesignCharts } from "./design-charts";

export const metadata: Metadata = { title: "Design preview" };

/** Admin-only showcase of the design system with SAMPLE numbers (no real data). */
export default async function DesignPage() {
  const [me, t, ts] = await Promise.all([getMe(), getTranslations("design"), getTranslations("status")]);
  if (me?.role !== "admin") notFound();

  return (
    <Page className="gap-8">
      <PageHeader
        title={t("title")}
        meta={
          <span className="flex items-center gap-2">
            <TriangleAlert aria-hidden className="size-5 text-status-warning" />
            {t("sample")}
          </span>
        }
      />

      <section aria-labelledby="buttons" className="flex flex-col gap-3">
        <h2 id="buttons" className="text-lg font-semibold">{t("buttons")}</h2>
        <div className="flex flex-wrap gap-3">
          <Button size="lg">
            <CalendarPlus aria-hidden />
            {t("primary")}
          </Button>
          <Button variant="secondary">
            <NotebookPen aria-hidden />
            {t("secondary")}
          </Button>
          <Button variant="danger">
            <Trash2 aria-hidden />
            {t("danger")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="status" className="flex flex-col gap-3">
        <h2 id="status" className="text-lg font-semibold">{t("status")}</h2>
        <div className="flex flex-wrap gap-2">
          <StatusBadge kind="good" label={ts("confirmed")} />
          <StatusBadge kind="warning" label={ts("waiting")} />
          <StatusBadge kind="serious" label={ts("warning")} />
          <StatusBadge kind="critical" label={ts("cancelled")} />
        </div>
      </section>

      <section aria-labelledby="kpis" className="flex flex-col gap-3">
        <h2 id="kpis" className="text-lg font-semibold">{t("kpis")}</h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatTile label={t("kpiCollected")} value={formatINR(8450000)} current={84500} previous={71200} trend={[52, 61, 58, 70, 66, 71, 84]} />
          <StatTile label={t("kpiAppointments")} value="42" current={42} previous={38} trend={[30, 35, 33, 38, 41, 38, 42]} />
          <StatTile label={t("kpiNoShows")} value="3" current={3} previous={5} goodWhen="down" trend={[6, 4, 5, 5, 4, 5, 3]} />
          <StatTile label={t("kpiPending")} value="7" current={7} previous={7} />
        </div>
      </section>

      <section aria-labelledby="charts" className="flex flex-col gap-3">
        <h2 id="charts" className="text-lg font-semibold">{t("charts")}</h2>
        <DesignCharts />
      </section>
    </Page>
  );
}
