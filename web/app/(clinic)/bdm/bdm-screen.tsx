"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BatteryMedium, Crosshair, Download, MapPinOff, Route } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { formatDateTime, istDateString, type StatusKind } from "@pearl/shared";
import { BdmMap, type MapMarker, type MarkerTone } from "@/components/bdm/bdm-map";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, PageHeader } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { bdmTone, minutesSince, type LiveBdm } from "@/lib/bdm";
import { useLiveBdm } from "@/lib/realtime";
import { rpc } from "@/lib/rpc";
import { useDateRangeCheck } from "@/lib/use-date-range";
import { useFeedback } from "@/lib/use-feedback";

const BADGE: Record<MarkerTone, StatusKind> = { good: "good", warning: "warning", critical: "critical", muted: "serious" };

/** The admin's BDM page: who is where right now (live), each day's sheet, and the Excel report. */
export function BdmScreen() {
  const t = useTranslations("bdm");
  const { saved, failed } = useFeedback();
  const live = useQuery({ queryKey: ["bdm_live"], queryFn: () => rpc<LiveBdm[]>("bdm_live"), refetchInterval: 60_000 });
  useLiveBdm([["bdm_live"]]);
  // "Seen n min ago" is measured from the last refresh (every minute, and on each live update).
  const now = live.dataUpdatedAt;
  const today = istDateString(new Date());
  const people = useMemo(() => live.data ?? [], [live.data]);
  const markers: MapMarker[] = useMemo(
    () =>
      people
        .filter((b) => b.lat !== null && b.lng !== null)
        .map((b) => ({ id: b.staff_id, lat: b.lat!, lng: b.lng!, label: `${b.name}: ${t(`state.${b.state}`)}`, tone: bdmTone(b, now) })),
    [people, now, t],
  );
  const locate = useMutation({
    mutationFn: (staffId: string) => rpc("bdm_locate_now", { p_staff_id: staffId }),
    onSuccess: () => saved(t("locateAsked")),
    onError: failed,
  });

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <BdmMap markers={markers} label={t("mapLabel")} className="h-72 sm:h-96 xl:h-[28rem]" />
        <section aria-label={t("people")} className="flex flex-col gap-2">
          {live.isPending && <RowSkeletons rows={3} />}
          {live.isSuccess && people.length === 0 && <p className="text-text-secondary">{t("nobody")}</p>}
          <ul className="flex flex-col gap-2">
            {people.map((b) => {
              const tone = bdmTone(b, now);
              const silent = minutesSince(b.last_heartbeat_at, now);
              return (
                <li key={b.staff_id} className="flex flex-col gap-1 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{b.name}</span>
                    <StatusBadge kind={BADGE[tone]} label={b.day?.ended_at ? t("dayEnded") : !b.day ? t("notStarted") : t(`state.${b.state}`)} />
                  </div>
                  <p className="flex flex-wrap gap-x-3 text-[0.95rem] text-text-secondary">
                    {silent !== null && <span>{silent < 1 ? t("seenNow") : t("seenAgo", { n: silent })}</span>}
                    {b.battery !== null && (
                      <span className="inline-flex items-center gap-1">
                        <BatteryMedium aria-hidden className="size-4" />
                        {b.battery}%{b.charging ? ` ${t("charging")}` : ""}
                      </span>
                    )}
                    {b.gps_on === false && (
                      <span className="inline-flex items-center gap-1">
                        <MapPinOff aria-hidden className="size-4" />
                        {t("gpsOff")}
                      </span>
                    )}
                    {b.day?.start_in_geofence === false && <span>{t("startedAway")}</span>}
                  </p>
                  {b.day && b.day.flags.length > 0 && (
                    <p className="text-[0.95rem]">{b.day.flags.map((f) => (t.has(`flag.${f}`) ? t(`flag.${f}`) : f)).join(" · ")}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="secondary">
                      <Link href={`/bdm/${b.staff_id}?date=${today}`}>
                        <Route aria-hidden />
                        {t("daySheet")}
                      </Link>
                    </Button>
                    {b.day && !b.day.ended_at && (
                      <Button variant="secondary" disabled={locate.isPending} onClick={() => locate.mutate(b.staff_id)}>
                        <Crosshair aria-hidden />
                        {t("locateNow")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <ReportCard />
    </Page>
  );
}

interface ReportRow {
  date: string;
  name: string;
  started_at: string | null;
  ended_at: string | null;
  in_office_at_start: boolean | null;
  office: string | null;
  visits: string;
  leads: string;
  km_actual: number;
  km_estimated: number;
  km_total: number;
  break_minutes: number;
  break_allowed_minutes: number;
  travel_minutes: number;
  meeting_minutes: number;
  flags: string;
  auto_ended: boolean;
}

/** Excel report: one row per BDM per day (PLAN.md D1 bdm_report). */
function ReportCard() {
  const t = useTranslations("bdm");
  const { failed } = useFeedback();
  const today = istDateString(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const range = useDateRangeCheck(from, to);
  const download = useMutation({
    mutationFn: async () => {
      const rows = await rpc<ReportRow[]>("bdm_report", { p_from: from, p_to: to });
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const time = (v: string | null) => (v ? formatDateTime(new Date(v)) : "");
      const header = [
        t("report.date"), t("report.name"), t("report.start"), t("report.end"), t("report.inOffice"), t("report.office"),
        t("report.visits"), t("report.leads"), t("report.kmActual"), t("report.kmEstimated"), t("report.kmTotal"),
        t("report.breakMinutes"), t("report.breakAllowed"), t("report.travelMinutes"), t("report.meetingMinutes"), t("report.flags"),
      ].map((value) => ({ value, fontWeight: "bold" as const }));
      const data = rows.map((r) => [
        { value: r.date.split("-").reverse().join("/") },
        { value: r.name },
        { value: time(r.started_at) },
        { value: time(r.ended_at) + (r.auto_ended ? ` (${t("report.autoEnded")})` : "") },
        { value: r.in_office_at_start === null ? "" : r.in_office_at_start ? t("report.yes") : t("report.no") },
        { value: r.office ?? "" },
        { type: Number, value: Number(r.visits) },
        { type: Number, value: Number(r.leads) },
        { type: Number, value: Number(r.km_actual) },
        { type: Number, value: Number(r.km_estimated) },
        { type: Number, value: Number(r.km_total) },
        { type: Number, value: Number(r.break_minutes) },
        { type: Number, value: Number(r.break_allowed_minutes) },
        { type: Number, value: Number(r.travel_minutes) },
        { type: Number, value: Number(r.meeting_minutes) },
        { value: r.flags },
      ]);
      await writeXlsxFile([header, ...data], { columns: header.map((_, i) => ({ width: i === 1 ? 24 : i === 15 ? 30 : 14 })) }).toFile(
        `bdm-report-${from}-to-${to}.xlsx`,
      );
      return rows.length;
    },
    onError: failed,
  });
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <CardTitle>{t("report.title")}</CardTitle>
        <CardDescription>{t("report.description")}</CardDescription>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t("report.from")} error={range.fromError} className="w-48">
          {(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label={t("report.to")} error={range.toError} className="w-48">
          {(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <Button disabled={!range.valid || download.isPending} onClick={() => download.mutate()}>
          <Download aria-hidden />
          {download.isPending ? t("report.preparing") : t("report.download")}
        </Button>
      </div>
      {download.isSuccess && <p className="text-text-secondary">{t("report.done", { n: download.data })}</p>}
    </Card>
  );
}
