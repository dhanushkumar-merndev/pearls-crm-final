"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, ChevronDown, Footprints, Inbox, ListTodo, Repeat } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { chartTokens, formatINR, formatTime, istDateString, type ThemeMode } from "@pearl/shared";
import { AppointmentActions, type ApptCard } from "@/components/appointments/appointment-actions";
import { BookDialog, WalkInDialog } from "@/components/appointments/book-dialog";
import { ApptStatusBadge } from "@/components/appointments/status";
import { EChart } from "@/components/charts/echart";
import type { ChartTheme } from "@/components/charts/chart-theme";
import { StatTile } from "@/components/kpi/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TileSkeletons } from "@/components/ui/skeletons";
import { useLiveAppointments } from "@/lib/realtime";
import { rpc } from "@/lib/rpc";

interface TodayData {
  counts: Record<string, number>;
  waiting: ApptCard[];
  upcoming: ApptCard[];
  followups_due: number;
  pending_registrations: number;
  sessions_due_week: number;
}
interface Dashboard {
  collections: { total_paise: number; by_mode: { mode: string; paise: number }[]; bills: number };
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
  const todo = (board.data?.followups_due ?? 0) + (board.data?.sessions_due_week ?? 0) + (board.data?.pending_registrations ?? 0);

  const arrivals = useCallback(
    (_theme: ChartTheme, mode: ThemeMode) => ({
      legend: {},
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
      legend: {},
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
      {/* One primary action; the to-do lists (with their counts) are one tap away under "More". */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog("book")}>
          <CalendarPlus aria-hidden />
          {t("book")}
        </Button>
        <Button variant="secondary" onClick={() => setDialog("walkin")}>
          <Footprints aria-hidden />
          {t("walkIn")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <ListTodo aria-hidden />
              {t("toDo", { n: todo })}
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem asChild>
              <Link href="/followups">
                <ListTodo aria-hidden />
                {t("followups", { n: board.data?.followups_due ?? 0 })}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/sessions">
                <Repeat aria-hidden />
                {t("sessionsDue", { n: board.data?.sessions_due_week ?? 0 })}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/patients/pending">
                <Inbox aria-hidden />
                {t("pendingRegistrations", { n: board.data?.pending_registrations ?? 0 })}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {board.isPending ? (
        <TileSkeletons count={6} className="md:grid-cols-3 xl:grid-cols-6" />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label={t("tile.total")} value={String(c.total ?? 0)} />
          <StatTile label={t("tile.waitingConfirmation")} value={String(c.pending_confirmation ?? 0)} />
          <StatTile label={t("tile.arrived")} value={String((c.arrived ?? 0) + (c.with_doctor ?? 0))} />
          <StatTile label={t("tile.done")} value={String(c.done ?? 0)} />
          <StatTile label={t("tile.noShow")} value={String(c.no_show ?? 0)} goodWhen="down" />
          <StatTile label={t("tile.walkIns")} value={String(c.walk_ins ?? 0)} />
        </div>
      )}
      {dash.data && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-border p-4">
          <span className="text-lg font-semibold">{t("collected", { amount: formatINR(dash.data.collections.total_paise) })}</span>
          {dash.data.collections.by_mode.map((m) => (
            <span key={m.mode} className="text-text-secondary tabular-nums">
              {m.mode}: {formatINR(m.paise)}
            </span>
          ))}
          <span className="text-text-secondary">{t("billsToday", { n: dash.data.collections.bills })}</span>
        </div>
      )}

      {/* items-start: each card is as tall as its own list (no empty stretched card). */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("waiting")}</CardTitle>
          {board.data?.waiting.length === 0 && <p className="text-text-secondary">{t("nobodyWaiting")}</p>}
          <ul className="flex flex-col gap-2">
            {board.data?.waiting.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 rounded-xl border border-border p-2.5">
                {/* Two lines on every width: who (in full), then status and actions. */}
                <span className="min-w-0">
                  <span className="block font-medium break-words">
                    {a.queue_no ? `#${a.queue_no} ` : ""}
                    {a.patient}
                    {a.lead_only && <LeadTag />}
                  </span>
                  <span className="block text-[0.9rem] text-text-secondary">{[a.doctor, a.uhid].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <ApptStatusBadge status={a.status} />
                  <AppointmentActions appt={a} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("upcoming")}</CardTitle>
          {board.data?.upcoming.length === 0 && <p className="text-text-secondary">{t("nothingUpcoming")}</p>}
          <ul className="flex flex-col gap-2">
            {board.data?.upcoming.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 rounded-xl border border-border p-2.5">
                <span className="flex min-w-0 items-start gap-3">
                  <span className="w-20 shrink-0 font-medium whitespace-nowrap tabular-nums">{a.slot_start ? formatTime(new Date(a.slot_start)) : ""}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">
                      {a.patient}
                      {a.lead_only && <LeadTag />}
                    </span>
                    <span className="block text-[0.9rem] text-text-secondary">{a.doctor}</span>
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <ApptStatusBadge status={a.status} />
                  <AppointmentActions appt={a} />
                </span>
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
            empty={dash.data.arrivals_by_hour.every((r) => !r.today && !r.typical)}
            table={{
              columns: [t("hour"), t("todayArrivals"), t("typical")],
              rows: dash.data.arrivals_by_hour.map((r) => [hourLabel(r.hour), r.today, r.typical]),
            }}
          />
          <EChart
            title={t("loadTitle")}
            option={load}
            // One row per doctor, plus room for the six-status legend.
            height={Math.max(176, dash.data.doctor_load.length * 32 + 112)}
            empty={dash.data.doctor_load.length === 0}
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

/** A booking for a lead (sales booked it; no patient file yet): reception registers them on arrival. */
function LeadTag() {
  const t = useTranslations("today");
  return <span className="ml-2 inline-block rounded-full border whitespace-nowrap border-border px-2 py-0.5 text-[0.9rem] font-normal text-text-secondary">{t("leadOnly")}</span>;
}
