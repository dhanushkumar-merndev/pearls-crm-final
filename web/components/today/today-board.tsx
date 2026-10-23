"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Footprints, Inbox, ListTodo } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { chartTokens, formatTime, istDateString, type ThemeMode } from "@pearl/shared";
import { AppointmentActions, type ApptCard } from "@/components/appointments/appointment-actions";
import { BookDialog, WalkInDialog } from "@/components/appointments/book-dialog";
import { ApptStatusBadge } from "@/components/appointments/status";
import { EChart } from "@/components/charts/echart";
import type { ChartTheme } from "@/components/charts/chart-theme";
import { StatTile } from "@/components/kpi/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useLiveAppointments } from "@/lib/realtime";
import { rpc } from "@/lib/rpc";

interface TodayData {
  counts: Record<string, number>;
  waiting: ApptCard[];
  upcoming: ApptCard[];
  followups_due: number;
  pending_registrations: number;
}
interface Dashboard {
  arrivals_by_hour: { hour: number; today: number; typical: number }[];
  doctor_load: { doctor: string; counts: Record<string, number> }[];
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const LOAD = ["pending_confirmation", "confirmed", "arrived", "with_doctor", "done", "no_show"] as const;

/** Reception home (PLAN.md B6): today's tiles, who is waiting, what's next, live. */
export function TodayBoard() {
  const t = useTranslations("today");
  const s = useTranslations("appt.status");
  const day = istDateString(new Date());
  const board = useQuery({ queryKey: ["today_board", day], queryFn: () => rpc<TodayData>("today_board", { p_date: day }) });
  const dash = useQuery({ queryKey: ["dashboard_reception", day], queryFn: () => rpc<Dashboard>("dashboard_reception", { p_date: day }) });
  useLiveAppointments(day, [["today_board", day], ["dashboard_reception", day]]);
  const [dialog, setDialog] = useState<"book" | "walkin" | null>(null);
  const c = board.data?.counts ?? {};

  const arrivals = useCallback(
    (_theme: ChartTheme, mode: ThemeMode) => ({
      grid: { left: 40, right: 16, top: 40, bottom: 32 },
      legend: { top: 0, left: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "category", data: (dash.data?.arrivals_by_hour ?? []).map((r) => hourLabel(r.hour)) },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        { name: t("typical"), type: "bar", data: (dash.data?.arrivals_by_hour ?? []).map((r) => r.typical), itemStyle: { color: chartTokens(mode).emphasisGray } },
        { name: t("todayArrivals"), type: "bar", data: (dash.data?.arrivals_by_hour ?? []).map((r) => r.today) },
      ],
    }),
    [dash.data, t],
  );
  const load = useCallback(
    () => ({
      grid: { left: 96, right: 16, top: 40, bottom: 24 },
      legend: { top: 0, left: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", minInterval: 1 },
      yAxis: { type: "category", data: (dash.data?.doctor_load ?? []).map((d) => d.doctor) },
      series: LOAD.map((status) => ({
        name: s(status),
        type: "bar",
        stack: "load",
        data: (dash.data?.doctor_load ?? []).map((d) => d.counts[status] ?? 0),
      })),
    }),
    [dash.data, s],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog("book")}>
          <CalendarPlus aria-hidden />
          {t("book")}
        </Button>
        <Button variant="secondary" onClick={() => setDialog("walkin")}>
          <Footprints aria-hidden />
          {t("walkIn")}
        </Button>
        <Button asChild variant="secondary">
          <Link href="/followups">
            <ListTodo aria-hidden />
            {t("followups", { n: board.data?.followups_due ?? 0 })}
          </Link>
        </Button>
        {(board.data?.pending_registrations ?? 0) > 0 && (
          <Button asChild variant="secondary">
            <Link href="/patients/pending">
              <Inbox aria-hidden />
              {t("pendingRegistrations", { n: board.data!.pending_registrations })}
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label={t("tile.total")} value={String(c.total ?? 0)} />
        <StatTile label={t("tile.waitingConfirmation")} value={String(c.pending_confirmation ?? 0)} />
        <StatTile label={t("tile.arrived")} value={String((c.arrived ?? 0) + (c.with_doctor ?? 0))} />
        <StatTile label={t("tile.done")} value={String(c.done ?? 0)} />
        <StatTile label={t("tile.noShow")} value={String(c.no_show ?? 0)} goodWhen="down" />
        <StatTile label={t("tile.walkIns")} value={String(c.walk_ins ?? 0)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("waiting")}</CardTitle>
          {board.data?.waiting.length === 0 && <p className="text-text-secondary">{t("nobodyWaiting")}</p>}
          <ul className="flex flex-col gap-2">
            {board.data?.waiting.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.queue_no ? `#${a.queue_no} ` : ""}{a.patient}</span>
                  <span className="block text-[0.9rem] text-text-secondary">{[a.doctor, a.uhid].filter(Boolean).join(" · ")}</span>
                </span>
                <ApptStatusBadge status={a.status} />
                <AppointmentActions appt={a} />
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("upcoming")}</CardTitle>
          {board.data?.upcoming.length === 0 && <p className="text-text-secondary">{t("nothingUpcoming")}</p>}
          <ul className="flex flex-col gap-2">
            {board.data?.upcoming.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
                <span className="w-20 font-medium tabular-nums">{a.slot_start ? formatTime(new Date(a.slot_start)) : ""}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.patient}</span>
                  <span className="block text-[0.9rem] text-text-secondary">{a.doctor}</span>
                </span>
                <ApptStatusBadge status={a.status} />
                <AppointmentActions appt={a} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {dash.data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <EChart
            title={t("arrivalsTitle")}
            option={arrivals}
            table={{
              columns: [t("hour"), t("todayArrivals"), t("typical")],
              rows: dash.data.arrivals_by_hour.map((r) => [hourLabel(r.hour), r.today, r.typical]),
            }}
          />
          <EChart
            title={t("loadTitle")}
            option={load}
            table={{
              columns: [t("doctor"), ...LOAD.map((x) => s(x))],
              rows: dash.data.doctor_load.map((d) => [d.doctor, ...LOAD.map((x) => d.counts[x] ?? 0)]),
            }}
          />
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "book" && <BookDialog onDone={() => setDialog(null)} />}
        {dialog === "walkin" && <WalkInDialog onDone={() => setDialog(null)} />}
      </Dialog>
    </div>
  );
}
