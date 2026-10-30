"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileInput, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { formatDateTime, formatINR, formatINRShort } from "@pearl/shared";
import { EChart } from "@/components/charts/echart";
import { StatTile } from "@/components/kpi/stat-tile";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { CardSkeleton, TileSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { PRESETS, rangeFor, type Preset } from "@/lib/periods";
import { callFunction, rpc } from "@/lib/rpc";
import { useDateRangeCheck } from "@/lib/use-date-range";
import { cn } from "@/lib/utils";
import { CampaignStatus, dayLabel, money, num, ratio, roas } from "./ad-format";
import { CampaignSheet } from "./campaign-sheet";
import { ImportLeadsDialog } from "./import-leads-dialog";

export interface AdTotals {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  meta_leads: number;
  crm_leads: number;
  contacted: number;
  booked: number;
  converted: number;
  collected: number;
  campaigns: number;
  active: number;
  unlinked: number;
}
export interface AdCampaignRow {
  id: string;
  name: string;
  objective: string | null;
  effective_status: string | null;
  daily_budget_paise: number | null;
  lifetime_budget_paise: number | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  meta_leads: number;
  crm_leads: number;
  contacted: number;
  booked: number;
  converted: number;
  collected: number;
}
export interface DayRow {
  day: string;
  spend: number;
  meta_leads: number;
  crm_leads: number;
}
interface Overview {
  account: {
    id: string;
    name: string | null;
    last_synced_at: string | null;
    last_error: string | null;
    synced_through: string | null;
    backfilled_from: string | null;
  } | null;
  totals: AdTotals;
  daily: DayRow[];
  campaigns: AdCampaignRow[];
}

const STATUSES = ["", "active", "paused", "off"] as const;
type StatusFilter = (typeof STATUSES)[number];
type SortKey = "spend" | "meta_leads" | "cpl" | "crm_leads" | "booked" | "converted" | "cpp" | "collected";

function statusGroup(s: string | null): Exclude<StatusFilter, ""> {
  if (s === "ACTIVE") return "active";
  if (s && s.includes("PAUSED")) return "paused";
  return "off";
}

function sortValue(c: AdCampaignRow, key: SortKey): number {
  if (key === "cpl") return c.meta_leads ? c.spend / c.meta_leads : Number.POSITIVE_INFINITY;
  if (key === "cpp") return c.converted ? c.spend / c.converted : Number.POSITIVE_INFINITY;
  return c[key];
}

/**
 * Leads → Ads (PLAN.md phase 16): what each Meta campaign cost and what it brought in the
 * CRM — leads, bookings, patients and money collected. Rows open a side panel with the
 * campaign's days, ads and leads. Numbers come from the database copy (synced every 3 hours,
 * or now with "Sync now").
 */
export function AdsDashboard() {
  const t = useTranslations("ads");
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<Preset>("mtd");
  const [custom, setCustom] = useState(() => rangeFor("mtd"));
  const [status, setStatus] = useState<StatusFilter>("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "spend", desc: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const range = preset === "custom" ? custom : rangeFor(preset);
  const check = useDateRangeCheck(range.from, range.to);

  const overview = useQuery({
    queryKey: ["ads_overview", range.from, range.to],
    enabled: check.valid,
    staleTime: 60_000,
    queryFn: () => rpc<Overview>("ads_overview", { p_from: range.from, p_to: range.to }),
  });
  const sync = useMutation({
    mutationFn: () => callFunction<{ ok: boolean; error?: string; rate_limited?: boolean }>("meta-ads", { source: "staff" }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["ads_overview"] }),
  });
  const d = overview.data;
  const tl = d?.totals;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (d?.campaigns ?? []).filter(
      (c) => (!status || statusGroup(c.effective_status) === status) && (!needle || c.name.toLowerCase().includes(needle)),
    );
    const dir = sort.desc ? -1 : 1;
    // "No leads yet" (an endless cost per lead) always sorts last.
    return list.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      if (x === y) return a.name.localeCompare(b.name);
      if (!Number.isFinite(x)) return 1;
      if (!Number.isFinite(y)) return -1;
      return (x - y) * dir;
    });
  }, [d, q, status, sort]);
  const chartRows = useMemo(() => [...(d?.campaigns ?? [])].filter((c) => c.spend > 0 || c.crm_leads > 0).slice(0, 10), [d]);

  const spendPerDay = useCallback(
    () => ({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => formatINR(Math.round(v * 100)) },
      xAxis: { type: "category", data: (d?.daily ?? []).map((x) => dayLabel(x.day)) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(Math.round(v * 100)) } },
      series: [{ name: t("spent"), type: "bar", data: (d?.daily ?? []).map((x) => x.spend / 100) }],
    }),
    [d, t],
  );
  const leadsPerDay = useCallback(
    () => ({
      legend: {},
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: (d?.daily ?? []).map((x) => dayLabel(x.day)) },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        { name: t("metaLeads"), type: "line", smooth: true, data: (d?.daily ?? []).map((x) => x.meta_leads) },
        { name: t("crmLeads"), type: "line", smooth: true, data: (d?.daily ?? []).map((x) => x.crm_leads) },
      ],
    }),
    [d, t],
  );
  const spendByCampaign = useCallback(
    () => ({
      grid: { right: 72 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => formatINR(Math.round(v * 100)) },
      xAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(Math.round(v * 100)) } },
      yAxis: { type: "category", inverse: true, data: chartRows.map((c) => c.name) },
      series: [
        {
          type: "bar",
          data: chartRows.map((c) => c.spend / 100),
          label: { show: true, position: "right", formatter: (p: { value: number }) => formatINRShort(Math.round(p.value * 100)) },
        },
      ],
    }),
    [chartRows],
  );
  const resultsByCampaign = useCallback(
    () => ({
      legend: {},
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", minInterval: 1 },
      yAxis: { type: "category", inverse: true, data: chartRows.map((c) => c.name) },
      series: [
        { name: t("crmLeads"), type: "bar", data: chartRows.map((c) => c.crm_leads) },
        { name: t("booked"), type: "bar", data: chartRows.map((c) => c.booked) },
        { name: t("patients"), type: "bar", data: chartRows.map((c) => c.converted) },
      ],
    }),
    [chartRows, t],
  );

  const changed = preset !== "mtd" || !!status || !!q;
  const clear = () => {
    setPreset("mtd");
    setCustom(rangeFor("mtd"));
    setStatus("");
    setQ("");
  };
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "cpl" && key !== "cpp" }));
  const head = (key: SortKey, label: string) => (
    <TH className="text-right" aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown aria-hidden className="size-3.5" /> : <ArrowUp aria-hidden className="size-3.5" />)}
      </button>
    </TH>
  );
  const syncResult = sync.data;
  const acct = d?.account;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="ads-sync">
        <p className="text-[0.95rem] text-text-secondary" role="status">
          {acct?.last_synced_at
            ? t("lastSynced", { when: formatDateTime(new Date(acct.last_synced_at)), account: acct.name ?? acct.id })
            : overview.isSuccess
              ? t("neverSynced")
              : ""}
          {acct?.backfilled_from && <> · {t("historyFrom", { day: dayLabel(acct.backfilled_from) })}</>}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw aria-hidden className={sync.isPending ? "animate-spin" : undefined} />
            {sync.isPending ? t("syncing") : t("syncNow")}
          </Button>
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <FileInput aria-hidden />
            {t("importPast")}
          </Button>
        </div>
      </div>
      {(syncResult && !syncResult.ok) || (!syncResult && acct?.last_error) ? (
        <p className="text-bad-text" role="alert">
          {syncResult?.error === "too_soon"
            ? t("tooSoon")
            : syncResult?.error === "not_configured"
              ? t("notConfigured")
              : syncResult?.error === "no_ad_account"
                ? t("noAdAccount")
                : t("syncFailed", { reason: syncResult?.error ?? acct?.last_error ?? "" })}
        </p>
      ) : syncResult?.ok ? (
        <p className="text-status-good" role="status">
          {t("synced")}
        </p>
      ) : sync.isError ? (
        <p className="text-bad-text" role="alert">
          {t("syncFailed", { reason: "" })}
        </p>
      ) : null}

      <FilterBar
        search={
          <Field label={t("search")} className="w-full sm:w-64">
            {(a) => <Input {...a} type="search" placeholder={t("searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />}
          </Field>
        }
        active={(preset === "mtd" ? 0 : 1) + (status ? 1 : 0)}
        canClear={changed}
        onClear={clear}
        actions={
          <Button variant="ghost" disabled={overview.isFetching} onClick={() => void overview.refetch()}>
            <RefreshCw aria-hidden className={overview.isFetching ? "animate-spin" : undefined} />
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
        <Field label={t("status")}>
          {(a) => (
            <Select {...a} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statusFilter.${s || "all"}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>

      {overview.isError && <p className="text-bad-text">{t("loadFailed")}</p>}
      {overview.isPending && check.valid && (
        <>
          <TileSkeletons count={8} />
          <div className="grid gap-4 xl:grid-cols-2">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </>
      )}

      {tl && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="ads-tiles">
          <StatTile label={t("spent")} value={formatINR(tl.spend)} hint={t("campaignsHint", { n: tl.campaigns, active: tl.active })} />
          <StatTile label={t("metaLeads")} value={num(tl.meta_leads)} hint={t("cplHint", { v: money(ratio(tl.spend, tl.meta_leads)) })} />
          <StatTile
            label={t("crmLeads")}
            value={num(tl.crm_leads)}
            hint={tl.unlinked ? t("unlinkedHint", { n: tl.unlinked }) : t("contactedHint", { n: num(tl.contacted) })}
          />
          <StatTile label={t("booked")} value={num(tl.booked)} hint={t("costEachHint", { v: money(ratio(tl.spend, tl.booked)) })} />
          <StatTile label={t("patients")} value={num(tl.converted)} hint={t("costEachHint", { v: money(ratio(tl.spend, tl.converted)) })} />
          <StatTile label={t("collected")} value={formatINR(tl.collected)} hint={t("roasHint", { v: roas(tl.collected, tl.spend) })} />
          <StatTile label={t("impressions")} value={num(tl.impressions)} hint={t("reachHint", { n: num(tl.reach) })} />
          <StatTile
            label={t("clicks")}
            value={num(tl.link_clicks)}
            hint={t("ctrHint", { v: tl.impressions ? ((tl.link_clicks / tl.impressions) * 100).toFixed(2) : "0" })}
          />
        </div>
      )}

      {d && (
        <div className="grid gap-4 xl:grid-cols-2">
          <EChart
            title={t("spendPerDay")}
            option={spendPerDay}
            empty={d.daily.every((x) => !x.spend)}
            table={{ columns: [t("day"), t("spent")], rows: d.daily.map((x) => [dayLabel(x.day), formatINR(x.spend)]) }}
          />
          <EChart
            title={t("leadsPerDay")}
            description={t("leadsPerDayHint")}
            option={leadsPerDay}
            empty={d.daily.every((x) => !x.meta_leads && !x.crm_leads)}
            table={{ columns: [t("day"), t("metaLeads"), t("crmLeads")], rows: d.daily.map((x) => [dayLabel(x.day), x.meta_leads, x.crm_leads]) }}
          />
          <EChart
            title={t("spendByCampaign")}
            option={spendByCampaign}
            rows={chartRows.length}
            empty={chartRows.every((c) => !c.spend)}
            table={{ columns: [t("campaign"), t("spent")], rows: chartRows.map((c) => [c.name, formatINR(c.spend)]) }}
          />
          <EChart
            title={t("resultsByCampaign")}
            option={resultsByCampaign}
            rows={chartRows.length}
            empty={chartRows.every((c) => !c.crm_leads)}
            table={{
              columns: [t("campaign"), t("crmLeads"), t("booked"), t("patients")],
              rows: chartRows.map((c) => [c.name, c.crm_leads, c.booked, c.converted]),
            }}
          />
        </div>
      )}

      {d && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("campaigns")}</h2>
          <p className="text-[0.95rem] text-text-secondary">{t("campaignsHelp")}</p>
          <Table data-testid="ads-campaigns">
            <THead>
              <tr>
                <TH>{t("campaign")}</TH>
                {head("spend", t("spent"))}
                {head("meta_leads", t("metaLeads"))}
                {head("cpl", t("cpl"))}
                {head("crm_leads", t("crmLeads"))}
                {head("booked", t("booked"))}
                {head("converted", t("patients"))}
                {head("cpp", t("cpp"))}
                {head("collected", t("collected"))}
              </tr>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={9}>{d.campaigns.length ? t("noMatch") : t("noCampaigns")}</EmptyRow>}
              {rows.map((c) => (
                <TR key={c.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setOpenId(c.id)}>
                  <TD className="max-w-[22rem]">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left font-medium text-link underline-offset-4 hover:underline"
                      onClick={(e) => (e.stopPropagation(), setOpenId(c.id))}
                    >
                      {c.name}
                    </button>
                    <CampaignStatus status={c.effective_status} className="mt-1" />
                  </TD>
                  <TD className="text-right tabular-nums">{formatINR(c.spend)}</TD>
                  <TD className="text-right tabular-nums">{num(c.meta_leads)}</TD>
                  <TD className="text-right tabular-nums">{money(ratio(c.spend, c.meta_leads))}</TD>
                  <TD className="text-right tabular-nums">{num(c.crm_leads)}</TD>
                  <TD className="text-right tabular-nums">{num(c.booked)}</TD>
                  <TD className="text-right tabular-nums">{num(c.converted)}</TD>
                  <TD className="text-right tabular-nums">{money(ratio(c.spend, c.converted))}</TD>
                  <TD className={cn("text-right tabular-nums", c.collected > 0 && "font-medium")}>{formatINR(c.collected)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        {openId && <CampaignSheet id={openId} from={range.from} to={range.to} row={d?.campaigns.find((c) => c.id === openId)} />}
      </Sheet>
      <Dialog open={importing} onOpenChange={setImporting}>
        {importing && <ImportLeadsDialog onDone={() => void queryClient.invalidateQueries({ queryKey: ["ads_overview"] })} />}
      </Dialog>
    </div>
  );
}
