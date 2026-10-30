"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ImageOff } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { formatINR, formatINRShort } from "@pearl/shared";
import { EChart } from "@/components/charts/echart";
import { SheetContent } from "@/components/ui/sheet";
import { CardSkeleton, TileSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { CampaignStatus, dayLabel, money, num, ratio, roas } from "./ad-format";
import type { AdCampaignRow, DayRow } from "./ads-dashboard";

interface CampaignDetail {
  campaign: {
    id: string;
    name: string;
    objective: string | null;
    effective_status: string | null;
    daily_budget_paise: number | null;
    lifetime_budget_paise: number | null;
  };
  collected: number;
  daily: DayRow[];
  ads: {
    id: string;
    name: string;
    adset_name: string | null;
    effective_status: string | null;
    thumbnail_url: string | null;
    preview_url: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    meta_leads: number;
    crm_leads: number;
    converted: number;
  }[];
  leads: { id: string; sl_no: number; name: string; stage: string; lead_date: string; owner: string | null; ad: string | null }[];
  lead_count: number;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-card px-3 py-2.5">
      <dt className="text-[0.85rem] text-text-secondary">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-[0.85rem] text-text-secondary">{hint}</dd>}
    </div>
  );
}

/** One campaign in the side panel: totals, spend per day, its ads (Meta's numbers + CRM leads) and its latest leads. */
export function CampaignSheet({ id, from, to, row }: { id: string; from: string; to: string; row?: AdCampaignRow }) {
  const t = useTranslations("ads");
  const st = useTranslations("leads.stage");
  const q = useQuery({
    queryKey: ["ads_campaign", id, from, to],
    staleTime: 60_000,
    queryFn: () => rpc<CampaignDetail>("ads_campaign", { p_campaign_id: id, p_from: from, p_to: to }),
  });
  const d = q.data;
  const option = useCallback(
    () => ({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => formatINR(Math.round(v * 100)) },
      xAxis: { type: "category", data: (d?.daily ?? []).map((x) => dayLabel(x.day)) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(Math.round(v * 100)) } },
      series: [{ name: t("spent"), type: "bar", data: (d?.daily ?? []).map((x) => x.spend / 100) }],
    }),
    [d, t],
  );
  const budget = d?.campaign.daily_budget_paise
    ? t("dailyBudget", { v: formatINR(d.campaign.daily_budget_paise) })
    : d?.campaign.lifetime_budget_paise
      ? t("lifetimeBudget", { v: formatINR(d.campaign.lifetime_budget_paise) })
      : undefined;

  return (
    <SheetContent
      title={d?.campaign.name ?? row?.name ?? t("campaign")}
      description={t("sheetRange", { from: dayLabel(from), to: dayLabel(to) })}
      data-testid="campaign-sheet"
    >
      {q.isError && <p className="text-bad-text">{t("loadFailed")}</p>}
      {q.isPending && (
        <div className="flex flex-col gap-4">
          <TileSkeletons count={4} />
          <CardSkeleton />
        </div>
      )}
      {d && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2 text-[0.95rem] text-text-secondary">
            <CampaignStatus status={d.campaign.effective_status} />
            {budget && <span>{budget}</span>}
            {d.campaign.objective && <span>· {d.campaign.objective.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase()}</span>}
          </div>
          {row && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Fact label={t("spent")} value={formatINR(row.spend)} />
              <Fact label={t("metaLeads")} value={num(row.meta_leads)} hint={t("cplHint", { v: money(ratio(row.spend, row.meta_leads)) })} />
              <Fact label={t("crmLeads")} value={num(row.crm_leads)} hint={t("contactedHint", { n: num(row.contacted) })} />
              <Fact label={t("booked")} value={num(row.booked)} />
              <Fact label={t("patients")} value={num(row.converted)} hint={t("costEachHint", { v: money(ratio(row.spend, row.converted)) })} />
              <Fact label={t("collected")} value={formatINR(d.collected)} hint={t("roasHint", { v: roas(d.collected, row.spend) })} />
            </dl>
          )}
          <EChart
            title={t("spendPerDay")}
            option={option}
            height={200}
            empty={d.daily.every((x) => !x.spend)}
            table={{
              columns: [t("day"), t("spent"), t("metaLeads"), t("crmLeads")],
              rows: d.daily.map((x) => [dayLabel(x.day), formatINR(x.spend), x.meta_leads, x.crm_leads]),
            }}
          />

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">{t("adsTitle", { n: d.ads.length })}</h3>
            {d.ads.length === 0 && <p className="text-text-secondary">{t("noAds")}</p>}
            <ul className="flex flex-col gap-2">
              {d.ads.map((a) => (
                <li key={a.id} className="flex gap-3 rounded-xl border border-border p-3">
                  {a.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Meta's own thumbnail URL, shown as is
                    <img src={a.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-secondary text-text-secondary">
                      <ImageOff aria-hidden className="size-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 font-medium break-words">{a.name}</p>
                      <CampaignStatus status={a.effective_status} />
                    </div>
                    {a.adset_name && <p className="text-[0.85rem] text-text-secondary">{t("adSet", { name: a.adset_name })}</p>}
                    <p className="mt-1 text-[0.9rem] text-text-secondary tabular-nums">
                      {t("adLine", {
                        spent: formatINR(a.spend),
                        leads: num(a.meta_leads),
                        crm: num(a.crm_leads),
                        patients: num(a.converted),
                        impressions: num(a.impressions),
                        clicks: num(a.clicks),
                      })}
                    </p>
                    {a.preview_url && (
                      <a
                        href={a.preview_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[0.9rem] text-link underline-offset-4 hover:underline"
                      >
                        <ExternalLink aria-hidden className="size-3.5" />
                        {t("preview")}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">{t("leadsTitle", { n: d.lead_count })}</h3>
            {d.lead_count > d.leads.length && <p className="text-[0.9rem] text-text-secondary">{t("latestOnly", { n: d.leads.length })}</p>}
            <Table>
              <THead>
                <tr>
                  <TH>{t("lead")}</TH>
                  <TH>{t("stage")}</TH>
                  <TH>{t("date")}</TH>
                  <TH>{t("owner")}</TH>
                  <TH>{t("ad")}</TH>
                </tr>
              </THead>
              <tbody>
                {d.leads.length === 0 && <EmptyRow colSpan={5}>{t("noLeads")}</EmptyRow>}
                {d.leads.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <Link href={`/leads/${l.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                        {l.name}
                      </Link>
                      <span className="ml-1.5 text-[0.85rem] text-text-secondary">#{l.sl_no}</span>
                    </TD>
                    <TD>{st(l.stage)}</TD>
                    <TD className="tabular-nums">{dayLabel(l.lead_date)}</TD>
                    <TD>{l.owner ?? t("unassigned")}</TD>
                    <TD className="max-w-48 truncate">{l.ad ?? "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </section>
        </div>
      )}
    </SheetContent>
  );
}
