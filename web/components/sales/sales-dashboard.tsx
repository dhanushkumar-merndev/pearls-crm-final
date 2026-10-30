"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { chartTokens, formatDate, formatINR, formatINRShort, type ThemeMode } from "@pearl/shared";
import { EChart } from "@/components/charts/echart";
import { StatTile } from "@/components/kpi/stat-tile";
import { useSalesStaff } from "@/components/leads/use-sales-staff";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { CardSkeleton, TileSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { pct, PRESETS, rangeFor, type Preset } from "@/lib/periods";
import { rpc } from "@/lib/rpc";
import { useDateRangeCheck } from "@/lib/use-date-range";

interface Tiles {
  new_leads: number;
  contacted_1h: number;
  contact_base: number;
  consultations_booked: number;
  shows: number;
  show_base: number;
  converted: number;
  cohort_converted: number;
  agreed_paise: number;
  overdue_followups?: number;
}
interface Dashboard {
  from: string;
  to: string;
  bucket: "day" | "week" | "month";
  tiles: Tiles;
  previous: Tiles | null;
  funnel: { steps: { stage: string; n: number }[]; lost: number; junk: number };
  by_source: { buckets: string[]; series: { id: string; label: string | null; data: number[] }[] };
  conversion_by_source: { source_id: string | null; label: string | null; leads: number; converted: number }[];
  leaderboard: { staff_id: string; name: string; leads: number; calls: number; connected: number; talk_s: number; converted: number; agreed_paise: number }[];
  heatmap: { dow: number; hour: number; n: number }[];
  lost_reasons: { id: string | null; label: string | null; n: number }[];
  agreed_vs_billed: { staff_id: string | null; name: string | null; agreed_paise: number; billed_paise: number; patients: number }[];
}

const DOW = [1, 2, 3, 4, 5, 6, 7];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8:00–21:00

/** Sales manager dashboard (PLAN.md B6): one call, tiles vs the previous period, funnel, sources, people, calls. */
export function SalesDashboard() {
  const t = useTranslations("salesDash");
  const st = useTranslations("leads.stage");
  const [preset, setPreset] = useState<Preset>("mtd");
  const [custom, setCustom] = useState(() => rangeFor("mtd"));
  const [staffId, setStaffId] = useState("");
  const staff = useSalesStaff();
  const range = preset === "custom" ? custom : rangeFor(preset);
  const check = useDateRangeCheck(range.from, range.to);
  const dash = useQuery({
    queryKey: ["dashboard_sales_manager", range.from, range.to, staffId],
    enabled: check.valid,
    staleTime: 60_000,
    queryFn: () =>
      rpc<Dashboard>("dashboard_sales_manager", { p_from: range.from, p_to: range.to, p_staff_ids: staffId ? [staffId] : null, p_compare: true }),
  });
  const d = dash.data;
  const tl = d?.tiles;
  const pv = d?.previous ?? undefined;

  const funnel = useCallback(
    () => ({
      grid: { right: 40 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", minInterval: 1 },
      yAxis: { type: "category", inverse: true, data: (d?.funnel.steps ?? []).map((s) => st(s.stage)) },
      series: [{ type: "bar", data: (d?.funnel.steps ?? []).map((s) => s.n), label: { show: true, position: "right" } }],
    }),
    [d, st],
  );
  const bySource = useCallback(
    () => ({
      legend: {},
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "category", data: (d?.by_source.buckets ?? []).map((b) => formatDate(new Date(`${b}T00:00:00+05:30`))) },
      yAxis: { type: "value", minInterval: 1 },
      series: (d?.by_source.series ?? []).map((s) => ({ name: s.label ?? t("other"), type: "bar", stack: "src", data: s.data })),
    }),
    [d, t],
  );
  const conversion = useCallback(
    () => ({
      grid: { right: 48 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${v}%` },
      xAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
      yAxis: { type: "category", inverse: true, data: (d?.conversion_by_source ?? []).map((s) => s.label ?? t("noSource")) },
      series: [
        {
          type: "bar",
          data: (d?.conversion_by_source ?? []).map((s) => pct(s.converted, s.leads)),
          label: { show: true, position: "right", formatter: "{c}%" },
        },
      ],
    }),
    [d, t],
  );
  const lost = useCallback(
    () => ({
      grid: { right: 40 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", minInterval: 1 },
      yAxis: { type: "category", inverse: true, data: (d?.lost_reasons ?? []).map((r) => r.label ?? t("noReason")) },
      series: [{ type: "bar", data: (d?.lost_reasons ?? []).map((r) => r.n), label: { show: true, position: "right" } }],
    }),
    [d, t],
  );
  const heatData = useMemo(() => {
    const max = Math.max(1, ...(d?.heatmap ?? []).map((h) => h.n));
    return { max, cells: (d?.heatmap ?? []).filter((h) => HOURS.includes(h.hour)).map((h) => [HOURS.indexOf(h.hour), h.dow - 1, h.n]) };
  }, [d]);
  const heat = useCallback(
    (theme: { color: string[] }, mode: ThemeMode) => ({
      // Room under the plot for the colour scale.
      grid: { bottom: 44 },
      tooltip: { position: "top" },
      xAxis: { type: "category", data: HOURS.map((h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`), splitArea: { show: false } },
      yAxis: { type: "category", data: DOW.map((x) => t(`dow.${x}`)) },
      visualMap: {
        min: 0,
        max: heatData.max,
        calculable: false,
        itemWidth: 12,
        itemHeight: 120,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        // One sequential ramp: from the grid colour to the first series colour (tokens only).
        inRange: { color: [chartTokens(mode).grid, theme.color[0]] },
      },
      series: [{ type: "heatmap", data: heatData.cells, label: { show: false } }],
    }),
    [heatData, t],
  );
  const agreed = useCallback(
    () => ({
      legend: {},
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => formatINR(Math.round(v * 100)) },
      xAxis: { type: "category", data: (d?.agreed_vs_billed ?? []).map((r) => r.name ?? t("unassigned")) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(Math.round(v * 100)) } },
      series: [
        { name: t("agreed"), type: "bar", data: (d?.agreed_vs_billed ?? []).map((r) => r.agreed_paise / 100) },
        { name: t("billed"), type: "bar", data: (d?.agreed_vs_billed ?? []).map((r) => r.billed_paise / 100) },
      ],
    }),
    [d, t],
  );

  return (
    <div className="flex flex-col gap-5">
      <FilterBar
        active={(preset === "mtd" ? 0 : 1) + (staffId ? 1 : 0)}
        actions={
          <Button variant="ghost" disabled={dash.isFetching} onClick={() => void dash.refetch()}>
            <RefreshCw aria-hidden className={dash.isFetching ? "animate-spin" : undefined} />
            {t("refresh")}
          </Button>
        }
      >
        <Field label={t("period")}>
          {(a) => (
            <Select {...a} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t(`preset.${p}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {preset === "custom" && (
          <>
            <Field label={t("from")} error={check.fromError}>
              {(a) => <Input {...a} type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />}
            </Field>
            <Field label={t("to")} error={check.toError}>
              {(a) => <Input {...a} type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />}
            </Field>
          </>
        )}
        <Field label={t("person")}>
          {(a) => (
            <Select {...a} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">{t("everyone")}</option>
              {staff.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>
      {dash.isError && <p className="text-bad-text">{t("loadFailed")}</p>}
      {dash.isPending && check.valid && (
        <>
          <TileSkeletons count={8} />
          <div className="grid gap-4 xl:grid-cols-2">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </>
      )}

      {tl && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatTile label={t("tile.newLeads")} value={String(tl.new_leads)} current={tl.new_leads} previous={pv?.new_leads} />
          <StatTile
            label={t("tile.contacted1h")}
            value={`${pct(tl.contacted_1h, tl.contact_base)}%`}
            current={pct(tl.contacted_1h, tl.contact_base)}
            previous={pv ? pct(pv.contacted_1h, pv.contact_base) : undefined}
          />
          <StatTile label={t("tile.booked")} value={String(tl.consultations_booked)} current={tl.consultations_booked} previous={pv?.consultations_booked} />
          <StatTile
            label={t("tile.showRate")}
            value={`${pct(tl.shows, tl.show_base)}%`}
            current={pct(tl.shows, tl.show_base)}
            previous={pv ? pct(pv.shows, pv.show_base) : undefined}
          />
          <StatTile label={t("tile.converted")} value={String(tl.converted)} current={tl.converted} previous={pv?.converted} />
          <StatTile
            label={t("tile.conversion")}
            value={`${pct(tl.cohort_converted, tl.new_leads)}%`}
            current={pct(tl.cohort_converted, tl.new_leads)}
            previous={pv ? pct(pv.cohort_converted, pv.new_leads) : undefined}
          />
          <StatTile label={t("tile.agreed")} value={formatINR(tl.agreed_paise)} current={tl.agreed_paise} previous={pv?.agreed_paise} />
          <StatTile label={t("tile.overdue")} value={String(tl.overdue_followups ?? 0)} goodWhen="down" />
        </div>
      )}

      {d && (
        <div className="grid gap-4 xl:grid-cols-2">
          <EChart
            title={t("funnelTitle")}
            description={t("funnelHint", { lost: d.funnel.lost, junk: d.funnel.junk })}
            option={funnel}
            rows={d.funnel.steps.length}
            empty={d.funnel.steps.every((s) => !s.n)}
            table={{ columns: [t("stage"), t("leads")], rows: d.funnel.steps.map((s) => [st(s.stage), s.n]) }}
          />
          <EChart
            title={t("sourcesTitle")}
            option={bySource}
            empty={d.by_source.series.every((s) => s.data.every((n) => !n))}
            table={{
              columns: [t("period"), ...d.by_source.series.map((s) => s.label ?? t("other"))],
              rows: d.by_source.buckets.map((b, i) => [formatDate(new Date(`${b}T00:00:00+05:30`)), ...d.by_source.series.map((s) => s.data[i] ?? 0)]),
            }}
          />
          <EChart
            title={t("conversionTitle")}
            option={conversion}
            rows={d.conversion_by_source.length}
            empty={d.conversion_by_source.length === 0}
            table={{
              columns: [t("source"), t("leads"), t("converted"), "%"],
              rows: d.conversion_by_source.map((s) => [s.label ?? t("noSource"), s.leads, s.converted, pct(s.converted, s.leads)]),
            }}
          />
          <EChart
            title={t("lostTitle")}
            option={lost}
            rows={d.lost_reasons.length}
            empty={d.lost_reasons.length === 0}
            table={{ columns: [t("reason"), t("leads")], rows: d.lost_reasons.map((r) => [r.label ?? t("noReason"), r.n]) }}
          />
          <EChart
            title={t("heatTitle")}
            description={t("heatHint")}
            option={heat}
            height={264}
            empty={d.heatmap.length === 0}
            table={{ columns: [t("day"), t("hour"), t("calls")], rows: d.heatmap.map((h) => [t(`dow.${h.dow}`), `${h.hour}:00`, h.n]) }}
          />
          <EChart
            title={t("agreedTitle")}
            description={t("agreedHint")}
            option={agreed}
            empty={d.agreed_vs_billed.length === 0}
            table={{
              columns: [t("person"), t("agreed"), t("billed"), t("patients")],
              rows: d.agreed_vs_billed.map((r) => [r.name ?? t("unassigned"), formatINR(r.agreed_paise), formatINR(r.billed_paise), r.patients]),
            }}
          />
        </div>
      )}

      {d && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("leaderboard")}</h2>
          <Table>
            <THead>
              <tr>
                <TH>{t("person")}</TH>
                <TH className="text-right">{t("leads")}</TH>
                <TH className="text-right">{t("calls")}</TH>
                <TH className="text-right">{t("connectedPct")}</TH>
                <TH className="text-right">{t("talkTime")}</TH>
                <TH className="text-right">{t("converted")}</TH>
                <TH className="text-right">{t("agreed")}</TH>
              </tr>
            </THead>
            <tbody>
              {d.leaderboard.length === 0 && <EmptyRow colSpan={7}>{t("nobody")}</EmptyRow>}
              {d.leaderboard.map((r) => (
                <TR key={r.staff_id}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-right tabular-nums">{r.leads}</TD>
                  <TD className="text-right tabular-nums">{r.calls}</TD>
                  <TD className="text-right tabular-nums">{pct(r.connected, r.calls)}%</TD>
                  <TD className="text-right tabular-nums">{`${Math.floor(r.talk_s / 3600)}h ${Math.floor((r.talk_s % 3600) / 60)}m`}</TD>
                  <TD className="text-right tabular-nums">{r.converted}</TD>
                  <TD className="text-right tabular-nums">{formatINR(r.agreed_paise)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}
