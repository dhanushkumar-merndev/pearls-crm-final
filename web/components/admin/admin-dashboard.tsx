"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { HardDrive, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { formatDate, formatDateTime, formatINR, formatINRShort, type StatusKind } from "@pearl/shared";
import { StorageMeter, type StorageUsage } from "@/components/admin/storage-meter";
import { EChart } from "@/components/charts/echart";
import { StatTile } from "@/components/kpi/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/ui/page";
import { CardSkeleton, TileSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { pct, PRESETS, rangeFor, type Preset } from "@/lib/periods";
import { rpc } from "@/lib/rpc";
import { useDateRangeCheck } from "@/lib/use-date-range";

interface Kpis {
  revenue_paise: number;
  collected_paise: number;
  refunds_paise: number;
  discount_paise: number;
  bills: number;
  new_patients: number;
  returning_patients: number;
  appointments: number;
  no_shows: number;
  admissions: number;
  discharges: number;
  stay_days: number;
  pharmacy_sales_paise: number;
  pharmacy_margin_paise: number;
  wa_sent: number;
  wa_delivered: number;
  wa_read: number;
  wa_cost_paise: number;
  by_bill_type?: { key: string; paise: number }[];
  by_category?: { key: string; label: string | null; paise: number }[];
  by_mode?: { key: string; label: string | null; paise: number }[];
  by_doctor?: { doctor_id: string; name: string; appointments: number; revenue_paise: number }[];
}

interface Dashboard {
  from: string;
  to: string;
  bucket: "day" | "week" | "month";
  kpis: Kpis;
  previous: Kpis | null;
  trend: { bucket: string; revenue_paise: number; collected_paise: number }[];
  outstanding: { total_paise: number; patients: number; ageing: { bucket: string; paise: number; patients: number }[] };
  sessions: { on_time: number; late: number; missed: number; overdue: number; upcoming: number };
  by_source: { source_id: string | null; label: string | null; paise: number; patients: number }[];
  funnel: { steps: { stage: string; n: number }[]; lost: number; junk: number };
  agreed_vs_billed: { staff_id: string | null; name: string | null; agreed_paise: number; billed_paise: number; patients: number }[];
  top_medicines: { item_id: string; name: string | null; qty: number; paise: number }[];
  pharmacy_stock: { stock_value_paise: number; near_expiry_value_paise: number };
  bdm: { on_duty: number; total: number; people: { staff_id: string; name: string; days: number; visits: number; leads: number; km: number }[] };
  storage: StorageUsage;
  backup: { last_files_at: string | null; last_export_at: string | null };
  integrations: { integration: string; state: "ok" | "error" | "unknown" | "off"; last_ok_at: string | null; last_error: string | null }[];
}

const STATE_KIND: Record<string, StatusKind> = { ok: "good", error: "critical", unknown: "warning", off: "serious" };
const rupees = (paise: number) => paise / 100;
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

/** Horizontal bar chart of labelled rupee amounts (biggest first, labels on the bars). */
function moneyBars(rows: { label: string; paise: number }[]) {
  return () => ({
    // Room for the amount printed after the longest bar; the names on the left size themselves.
    grid: { right: 64 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => formatINR(Math.round(v * 100)) },
    xAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(Math.round(v * 100)) } },
    yAxis: { type: "category", inverse: true, data: rows.map((r) => r.label) },
    series: [
      {
        type: "bar",
        data: rows.map((r) => rupees(r.paise)),
        label: { show: true, position: "right", formatter: (p: { value: number }) => formatINRShort(Math.round(p.value * 100)) },
      },
    ],
  });
}

/** Admin dashboard (PLAN.md B6): tiles vs the previous period, every section (fetched in three parts). */
export function AdminDashboard() {
  const t = useTranslations("adminDash");
  const s = useTranslations("salesDash");
  const st = useTranslations("leads.stage");
  const bt = useTranslations("bill.type");
  const [preset, setPreset] = useState<Preset>("mtd");
  const [custom, setCustom] = useState(() => rangeFor("mtd"));
  const range = preset === "custom" ? custom : rangeFor(preset);
  const check = useDateRangeCheck(range.from, range.to);
  const dash = useQuery({
    queryKey: ["dashboard_admin", range.from, range.to],
    enabled: check.valid,
    staleTime: 60_000,
    // Keep the old numbers on screen while a new period loads (no flash, charts keep their view).
    placeholderData: keepPreviousData,
    // Three parts side by side: each is quick, together they'd be slow for a long period.
    queryFn: async () => {
      const parts = await Promise.all(
        ["summary", "previous", "money"].map((part) =>
          rpc<Partial<Dashboard>>("dashboard_admin", { p_from: range.from, p_to: range.to, p_compare: true, p_parts: [part] }),
        ),
      );
      return Object.assign({}, ...parts) as Dashboard;
    },
  });
  const d = dash.data;
  const k = d?.kpis;
  const pv = d?.previous ?? undefined;
  const bucketLabel = useCallback(
    (b: string) => (d?.bucket === "month" ? formatDate(day(b)).slice(3) : formatDate(day(b))),
    [d?.bucket],
  );

  const trend = useCallback(
    () => ({
      legend: {},
      tooltip: { trigger: "axis", valueFormatter: (v: number) => formatINR(Math.round(v * 100)) },
      xAxis: { type: "category", data: (d?.trend ?? []).map((x) => bucketLabel(x.bucket)) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(Math.round(v * 100)) } },
      series: [
        { name: t("revenue"), type: "line", data: (d?.trend ?? []).map((x) => rupees(x.revenue_paise)), symbolSize: 6 },
        { name: t("collected"), type: "line", data: (d?.trend ?? []).map((x) => rupees(x.collected_paise)), symbolSize: 6 },
      ],
    }),
    [d, t, bucketLabel],
  );
  const ageing = useCallback(
    () => ({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => formatINR(Math.round(v * 100)) },
      xAxis: { type: "category", data: (d?.outstanding.ageing ?? []).map((a) => t(`age.${a.bucket}`)) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(Math.round(v * 100)) } },
      series: [{ type: "bar", data: (d?.outstanding.ageing ?? []).map((a) => rupees(a.paise)) }],
    }),
    [d, t],
  );
  const sessions = useCallback(
    () => {
      const keys = ["on_time", "late", "missed", "overdue", "upcoming"] as const;
      return {
        legend: {},
        tooltip: { trigger: "item" },
        xAxis: { type: "value", minInterval: 1 },
        yAxis: { type: "category", data: [t("sessions")], show: false },
        series: keys.map((key) => ({ name: t(`session.${key}`), type: "bar", stack: "s", data: [d?.sessions[key] ?? 0], label: { show: true } })),
      };
    },
    [d, t],
  );
  const funnel = useCallback(
    () => ({
      grid: { right: 40 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", minInterval: 1 },
      yAxis: { type: "category", inverse: true, data: (d?.funnel.steps ?? []).map((x) => st(x.stage)) },
      series: [{ type: "bar", data: (d?.funnel.steps ?? []).map((x) => x.n), label: { show: true, position: "right" } }],
    }),
    [d, st],
  );
  const agreed = useCallback(
    () => ({
      legend: {},
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => formatINR(Math.round(v * 100)) },
      xAxis: { type: "category", data: (d?.agreed_vs_billed ?? []).map((r) => r.name ?? s("unassigned")) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(Math.round(v * 100)) } },
      series: [
        { name: s("agreed"), type: "bar", data: (d?.agreed_vs_billed ?? []).map((r) => rupees(r.agreed_paise)) },
        { name: s("billed"), type: "bar", data: (d?.agreed_vs_billed ?? []).map((r) => rupees(r.billed_paise)) },
      ],
    }),
    [d, s],
  );

  // Memoised: a new option function would redraw the chart on every render.
  const bars = useMemo(() => {
    const billTypes = (k?.by_bill_type ?? []).map((x) => ({ label: bt(x.key), paise: x.paise }));
    const categories = (k?.by_category ?? []).map((x) => ({ label: x.label ?? t("uncategorised"), paise: x.paise }));
    const modes = (k?.by_mode ?? []).map((x) => ({ label: x.label ?? x.key, paise: x.paise }));
    const sources = (d?.by_source ?? []).map((x) => ({ label: x.label ?? t("direct"), paise: x.paise }));
    return {
      billTypes: { rows: billTypes, option: moneyBars(billTypes) },
      categories: { rows: categories, option: moneyBars(categories) },
      modes: { rows: modes, option: moneyBars(modes) },
      sources: { rows: sources, option: moneyBars(sources) },
    };
  }, [k, d?.by_source, bt, t]);
  const { billTypes, categories, modes, sources } = bars;
  const avgStay = k && k.discharges > 0 ? Math.round((k.stay_days / k.discharges) * 10) / 10 : 0;

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <FilterBar
        active={preset === "mtd" ? 0 : 1}
        actions={
          <Button variant="ghost" disabled={dash.isFetching} onClick={() => void dash.refetch()}>
            <RefreshCw aria-hidden className={dash.isFetching ? "animate-spin" : undefined} />
            {s("refresh")}
          </Button>
        }
      >
        <Field label={s("period")}>
          {(a) => (
            <Select {...a} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {s(`preset.${p}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {preset === "custom" && (
          <>
            <Field label={s("from")} error={check.fromError}>
              {(a) => <Input {...a} type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />}
            </Field>
            <Field label={s("to")} error={check.toError}>
              {(a) => <Input {...a} type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />}
            </Field>
          </>
        )}
      </FilterBar>
      {dash.isError && <p className="text-bad-text">{s("loadFailed")}</p>}
      {dash.isPending && check.valid && (
        <>
          <TileSkeletons count={8} />
          <div className="grid gap-4 xl:grid-cols-2">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </>
      )}

      {d && k && (
        <>
          <section aria-label={t("money")} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile label={t("revenue")} value={formatINR(k.revenue_paise)} current={k.revenue_paise} previous={pv?.revenue_paise}
              trend={d.trend.map((x) => x.revenue_paise)} />
            <StatTile label={t("collected")} value={formatINR(k.collected_paise)} current={k.collected_paise} previous={pv?.collected_paise}
              trend={d.trend.map((x) => x.collected_paise)} />
            <StatTile label={t("outstanding")} value={formatINR(d.outstanding.total_paise)} goodWhen="down" />
            <StatTile label={t("discounts")} value={formatINR(k.discount_paise)} current={k.discount_paise} previous={pv?.discount_paise} goodWhen="down" />
            <StatTile label={t("newPatients")} value={String(k.new_patients)} current={k.new_patients} previous={pv?.new_patients} />
            <StatTile label={t("returningPatients")} value={String(k.returning_patients)} current={k.returning_patients} previous={pv?.returning_patients} />
            <StatTile label={t("noShowRate")} value={`${pct(k.no_shows, k.appointments)}%`} current={pct(k.no_shows, k.appointments)}
              previous={pv ? pct(pv.no_shows, pv.appointments) : undefined} goodWhen="down" />
            <StatTile label={t("admissions")} value={String(k.admissions)} hint={t("admissionsHint", { days: avgStay })} current={k.admissions}
              previous={pv?.admissions} />
            <StatTile label={t("pharmacySales")} value={formatINR(k.pharmacy_sales_paise)} current={k.pharmacy_sales_paise} previous={pv?.pharmacy_sales_paise} />
            <StatTile label={t("pharmacyMargin")} value={formatINR(k.pharmacy_margin_paise)} current={k.pharmacy_margin_paise} previous={pv?.pharmacy_margin_paise} />
            <StatTile label={t("stockValue")} value={formatINR(d.pharmacy_stock.stock_value_paise)} />
            <StatTile label={t("nearExpiry")} value={formatINR(d.pharmacy_stock.near_expiry_value_paise)} goodWhen="down" />
            <StatTile label={t("whatsapp")} value={String(k.wa_sent)} hint={t("whatsappHint", { delivered: pct(k.wa_delivered, k.wa_sent), read: pct(k.wa_read, k.wa_sent) })}
              current={k.wa_sent} previous={pv?.wa_sent} />
            <StatTile label={t("whatsappCost")} value={formatINR(k.wa_cost_paise)} current={k.wa_cost_paise} previous={pv?.wa_cost_paise} goodWhen="down" />
            <StatTile label={t("bdmsOnDuty")} value={t("ofTotal", { n: d.bdm.on_duty, total: d.bdm.total })} />
            <StatTile label={t("bills")} value={String(k.bills)} current={k.bills} previous={pv?.bills} />
          </section>

          {/* Cards in a row share one height; each chart grows to fill its card, and a lone last card spans the row (no holes). */}
          <div className="grid gap-4 xl:grid-cols-2 xl:[&>*:last-child:nth-child(odd)]:col-span-2">
            <EChart
              title={t("trendTitle")}
              option={trend}
              empty={d.trend.every((x) => !x.revenue_paise && !x.collected_paise)}
              table={{
                columns: [s("period"), t("revenue"), t("collected")],
                rows: d.trend.map((x) => [bucketLabel(x.bucket), formatINR(x.revenue_paise), formatINR(x.collected_paise)]),
              }}
            />
            <EChart
              title={t("billTypeTitle")}
              option={billTypes.option}
              rows={billTypes.rows.length}
              empty={billTypes.rows.length === 0}
              table={{ columns: [t("billType"), t("revenue")], rows: billTypes.rows.map((r) => [r.label, formatINR(r.paise)]) }}
            />
            <EChart
              title={t("categoryTitle")}
              option={categories.option}
              rows={categories.rows.length}
              empty={categories.rows.length === 0}
              table={{ columns: [t("category"), t("revenue")], rows: categories.rows.map((r) => [r.label, formatINR(r.paise)]) }}
            />
            <EChart
              title={t("modesTitle")}
              option={modes.option}
              rows={modes.rows.length}
              empty={modes.rows.length === 0}
              table={{ columns: [t("mode"), t("collected")], rows: modes.rows.map((r) => [r.label, formatINR(r.paise)]) }}
            />
            <EChart
              title={t("ageingTitle")}
              description={t("ageingHint", { n: d.outstanding.patients })}
              option={ageing}
              empty={d.outstanding.ageing.every((a) => !a.paise)}
              table={{
                columns: [t("age.title"), t("outstanding"), t("patients")],
                rows: d.outstanding.ageing.map((a) => [t(`age.${a.bucket}`), formatINR(a.paise), a.patients]),
              }}
            />
            <EChart
              title={t("sessionsTitle")}
              description={t("sessionsHint")}
              option={sessions}
              height={128}
              empty={(["on_time", "late", "missed", "overdue", "upcoming"] as const).every((key) => !d.sessions[key])}
              table={{
                columns: [t("sessionState"), t("sessions")],
                rows: (["on_time", "late", "missed", "overdue", "upcoming"] as const).map((key) => [t(`session.${key}`), d.sessions[key]]),
              }}
            />
            <EChart
              title={t("sourceTitle")}
              description={t("sourceHint")}
              option={sources.option}
              rows={sources.rows.length}
              empty={sources.rows.length === 0}
              table={{ columns: [s("source"), t("revenue"), t("patients")], rows: d.by_source.map((r) => [r.label ?? t("direct"), formatINR(r.paise), r.patients]) }}
            />
            <EChart
              title={s("funnelTitle")}
              description={s("funnelHint", { lost: d.funnel.lost, junk: d.funnel.junk })}
              option={funnel}
              rows={d.funnel.steps.length}
              empty={d.funnel.steps.every((x) => !x.n)}
              table={{ columns: [s("stage"), s("leads")], rows: d.funnel.steps.map((x) => [st(x.stage), x.n]) }}
            />
            <EChart
              title={s("agreedTitle")}
              description={s("agreedHint")}
              option={agreed}
              empty={d.agreed_vs_billed.length === 0}
              table={{
                columns: [s("person"), s("agreed"), s("billed"), s("patients")],
                rows: d.agreed_vs_billed.map((r) => [r.name ?? s("unassigned"), formatINR(r.agreed_paise), formatINR(r.billed_paise), r.patients]),
              }}
            />
          </div>

          {/* Two independent columns: a short table doesn't leave a hole beside a long one. */}
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">{t("doctorsTitle")}</h2>
                <Table>
                  <THead>
                    <tr>
                      <TH>{t("doctor")}</TH>
                      <TH className="text-right">{t("appointments")}</TH>
                      <TH className="text-right">{t("revenue")}</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {(k.by_doctor ?? []).length === 0 && <EmptyRow colSpan={3}>{t("nothing")}</EmptyRow>}
                    {(k.by_doctor ?? []).map((r) => (
                      <TR key={r.doctor_id}>
                        <TD className="font-medium">{r.name}</TD>
                        <TD className="text-right tabular-nums">{r.appointments}</TD>
                        <TD className="text-right tabular-nums">{formatINR(r.revenue_paise)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </section>
              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">{t("bdmTitle")}</h2>
                <Table>
                  <THead>
                    <tr>
                      <TH>{s("person")}</TH>
                      <TH className="text-right">{t("days")}</TH>
                      <TH className="text-right">{t("visits")}</TH>
                      <TH className="text-right">{s("leads")}</TH>
                      <TH className="text-right">{t("km")}</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {d.bdm.people.length === 0 && <EmptyRow colSpan={5}>{t("nothing")}</EmptyRow>}
                    {d.bdm.people.map((r) => (
                      <TR key={r.staff_id}>
                        <TD className="font-medium">
                          <Link href={`/bdm/${r.staff_id}?date=${d.to}`} className="underline-offset-4 hover:underline">
                            {r.name}
                          </Link>
                        </TD>
                        <TD className="text-right tabular-nums">{r.days}</TD>
                        <TD className="text-right tabular-nums">{r.visits}</TD>
                        <TD className="text-right tabular-nums">{r.leads}</TD>
                        <TD className="text-right tabular-nums">{Number(r.km).toLocaleString("en-IN")}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </section>
            </div>
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">{t("medicinesTitle")}</h2>
                <Table>
                  <THead>
                    <tr>
                      <TH>{t("medicine")}</TH>
                      <TH className="text-right">{t("qty")}</TH>
                      <TH className="text-right">{t("sales")}</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {d.top_medicines.length === 0 && <EmptyRow colSpan={3}>{t("nothing")}</EmptyRow>}
                    {d.top_medicines.map((r) => (
                      <TR key={r.item_id}>
                        <TD className="font-medium">{r.name ?? "—"}</TD>
                        <TD className="text-right tabular-nums">{Number(r.qty)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(r.paise)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </section>
              <Card className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t("systemTitle")}</CardTitle>
                  <Button asChild variant="secondary">
                    <Link href="/admin/backup">
                      <HardDrive aria-hidden />
                      {t("backupCentre")}
                    </Link>
                  </Button>
                </div>
                <StorageMeter usage={d.storage} />
                <p>
                  {d.backup.last_files_at ? t("lastBackup", { when: formatDateTime(new Date(d.backup.last_files_at)) }) : t("noBackup")}
                  {" · "}
                  {d.backup.last_export_at ? t("lastExport", { when: formatDateTime(new Date(d.backup.last_export_at)) }) : t("noExport")}
                </p>
                <ul className="flex flex-wrap gap-2" aria-label={t("integrations")}>
                  {d.integrations.map((i) => (
                    <li key={i.integration} title={i.last_error ?? undefined}>
                      <StatusBadge kind={STATE_KIND[i.state] ?? "warning"} label={`${t(`integration.${i.integration}`)}: ${t(`state.${i.state}`)}`} />
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
