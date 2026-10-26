"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, Download, Footprints, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { formatDate, formatTime, istDateString, istDayStart } from "@pearl/shared";
import { AppointmentActions, type ApptCard } from "@/components/appointments/appointment-actions";
import { BookDialog, WalkInDialog } from "@/components/appointments/book-dialog";
import { ApptStatusBadge, type ApptStatus } from "@/components/appointments/status";
import type { LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, PageHeader, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { useLiveAppointments } from "@/lib/realtime";
import { downloadExcel } from "@/lib/excel";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { cn } from "@/lib/utils";
import { useDateRangeCheck } from "@/lib/use-date-range";

interface BoardSlot {
  start: string;
  end: string;
  capacity: number;
  blocked_reason: string | null;
  chips: ApptCard[];
}
interface BoardDoctor {
  id: string;
  name: string;
  colour_slot: number;
  on_leave: boolean;
  slots: BoardSlot[];
}
interface Board {
  date: string;
  holiday: string | null;
  doctors: BoardDoctor[];
  queue: ApptCard[];
}

const shiftDay = (day: string, by: number) => istDateString(new Date(istDayStart(day).getTime() + by * 86_400_000 + 3_600_000));

export function AppointmentsScreen() {
  const t = useTranslations("appointments");
  const [day, setDay] = useState(() => istDateString(new Date()));
  const [booking, setBooking] = useState<{ doctor?: LibraryItem; slot?: string } | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setWalkIn(true)}>
              <Footprints aria-hidden />
              {t("walkIn")}
            </Button>
            <Button onClick={() => setBooking({})}>
              <CalendarPlus aria-hidden />
              {t("book")}
            </Button>
          </>
        }
      />
      <Tabs.Root defaultValue="board" className="flex flex-col gap-4">
        <Tabs.List aria-label={t("views")} className="flex gap-1 border-b border-border">
          {(["board", "table"] as const).map((v) => (
            <Tabs.Trigger
              key={v}
              value={v}
              className="min-h-11 rounded-t-xl px-4 font-medium text-text-secondary data-[state=active]:border-b-2 data-[state=active]:border-foreground data-[state=active]:text-foreground"
            >
              {t(`view.${v}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="board">
          <BoardView day={day} setDay={setDay} onBook={(doctor, slot) => setBooking({ doctor, slot })} />
        </Tabs.Content>
        <Tabs.Content value="table">
          <TableView />
        </Tabs.Content>
      </Tabs.Root>
      <Dialog open={booking !== null} onOpenChange={(o) => !o && setBooking(null)}>
        {booking && <BookDialog doctor={booking.doctor ?? null} date={day} slot={booking.slot ?? null} onDone={() => setBooking(null)} />}
      </Dialog>
      <Dialog open={walkIn} onOpenChange={setWalkIn}>
        {walkIn && <WalkInDialog onDone={() => setWalkIn(false)} />}
      </Dialog>
    </div>
  );
}

function BoardView({ day, setDay, onBook }: { day: string; setDay: (d: string) => void; onBook: (doctor: LibraryItem, slot: string) => void }) {
  const t = useTranslations("appointments");
  const a = useTranslations("appt");
  const board = useQuery({
    queryKey: ["slot_board", day],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Board>("slot_board", { p_date: day }),
  });
  useLiveAppointments(day, [["slot_board", day]]);
  const data = board.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="secondary" size="icon" aria-label={t("prevDay")} onClick={() => setDay(shiftDay(day, -1))}>
          <ChevronLeft aria-hidden />
        </Button>
        <Field label={t("day")}>{(f) => <Input {...f} type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-48" />}</Field>
        <Button variant="secondary" size="icon" aria-label={t("nextDay")} onClick={() => setDay(shiftDay(day, 1))}>
          <ChevronRight aria-hidden />
        </Button>
        <Button variant="ghost" onClick={() => setDay(istDateString(new Date()))}>
          {t("today")}
        </Button>
      </div>
      {data?.holiday && <Card role="status">{t("holiday", { name: data.holiday })}</Card>}
      {data && data.doctors.length === 0 && <p className="text-text-secondary">{t("noDoctors")}</p>}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {data?.doctors.map((d) => (
          <Card key={d.id} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span aria-hidden className="size-3 rounded-full" style={{ background: `var(--chart-${(d.colour_slot % 8) + 1})` }} />
              {d.name}
              {d.on_leave && <span className="text-[0.9rem] font-normal text-bad-text">{t("onLeave")}</span>}
            </h2>
            {d.slots.length === 0 && <p className="text-text-secondary">{t("noHoursToday")}</p>}
            <ul className="flex flex-col gap-2">
              {d.slots.map((s) => {
                const left = Math.max(s.capacity - s.chips.length, 0);
                const bookable = !s.blocked_reason && left > 0;
                return (
                  <li key={s.start} className={cn("rounded-xl border border-border p-2", s.blocked_reason && "opacity-60")}>
                    <div className="flex items-center gap-2">
                      <span className="w-20 font-medium tabular-nums">{formatTime(new Date(s.start))}</span>
                      <span className="flex-1 text-[0.9rem] text-text-secondary">
                        {s.blocked_reason ? a(`blocked.${s.blocked_reason}`) : a("left", { n: left })}
                      </span>
                      {bookable && (
                        <Button
                          variant="ghost"
                          aria-label={t("bookAt", { time: formatTime(new Date(s.start)), doctor: d.name })}
                          onClick={() => onBook({ id: d.id, label: d.name, subtitle: null, on_the_fly: false, defaults: {} }, s.start)}
                        >
                          <Plus aria-hidden />
                          {t("bookShort")}
                        </Button>
                      )}
                    </div>
                    {s.chips.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {s.chips.map((c) => (
                          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary px-2 py-1.5">
                            <span className="min-w-0 flex-1 truncate font-medium">{c.patient}</span>
                            <ApptStatusBadge status={c.status} />
                            <AppointmentActions appt={{ ...c, doctor: d.name }} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
      {data && data.queue.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("queue")}</h2>
          <ul className="flex flex-col gap-1.5">
            {data.queue.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary px-2 py-1.5">
                <span className="w-12 font-semibold tabular-nums">#{c.queue_no}</span>
                <span className="min-w-0 flex-1 truncate">{c.patient}</span>
                <ApptStatusBadge status={c.status} />
                <AppointmentActions appt={c} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

interface TableRow extends ApptCard {
  doctor: string | null;
  type: string;
}
const STATUSES: ApptStatus[] = ["pending_confirmation", "confirmed", "arrived", "with_doctor", "done", "no_show", "cancelled", "rescheduled"];
const LIMIT = 25;

function TableView() {
  const t = useTranslations("appointments");
  const a = useTranslations("appt");
  const c = useTranslations("common");
  const { failed } = useFeedback();
  const today = istDateString(new Date());
  const [filters, setFilters] = useState({ from: today, to: today, status: "" });
  const [sort, setSort] = useState("slot_start");
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const args = (o: number, limit: number) => ({
    p_filters: { from: filters.from, to: filters.to, ...(filters.status ? { statuses: [filters.status] } : {}) },
    p_sort: sort,
    p_desc: false,
    p_offset: o,
    p_limit: limit,
  });
  const rangeCheck = useDateRangeCheck(filters.from, filters.to);
  const list = useQuery({
    enabled: rangeCheck.valid,
    queryKey: ["appointments_table", filters, sort, offset],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<{ total: number; rows: TableRow[] }>("appointments_table", args(offset, LIMIT)),
  });

  async function exportExcel() {
    setExporting(true);
    try {
      const rows: TableRow[] = [];
      for (let o = 0; ; o += 100) {
        const page = await rpc<{ total: number; rows: TableRow[] }>("appointments_table", args(o, 100));
        rows.push(...page.rows);
        if (rows.length >= page.total || page.rows.length === 0) break;
      }
      await downloadExcel(
        `appointments-${filters.from}-to-${filters.to}.xlsx`,
        [t("col.when"), t("col.patient"), "UHID", t("col.phone"), t("col.doctor"), t("col.type"), t("col.status")],
        rows.map((r) => [
          r.slot_start ? `${formatDate(new Date(r.slot_start))} ${formatTime(new Date(r.slot_start))}` : t("walkInQueue", { n: r.queue_no ?? 0 }),
          r.patient, r.uhid, r.phone, r.doctor, a(`types.${r.type}`), a(`status.${r.status}`),
        ]),
      );
    } catch (e) {
      failed(e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("from")} error={rangeCheck.fromError}>
          {(f) => <Input {...f} type="date" value={filters.from} onChange={(e) => (setFilters({ ...filters, from: e.target.value }), setOffset(0))} />}
        </Field>
        <Field label={t("to")} error={rangeCheck.toError}>
          {(f) => <Input {...f} type="date" value={filters.to} onChange={(e) => (setFilters({ ...filters, to: e.target.value }), setOffset(0))} />}
        </Field>
        <Field label={t("status")}>
          {(f) => (
            <Select {...f} value={filters.status} onChange={(e) => (setFilters({ ...filters, status: e.target.value }), setOffset(0))}>
              <option value="">{t("allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {a(`status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("sortBy")}>
          {(f) => (
            <Select {...f} value={sort} onChange={(e) => setSort(e.target.value)}>
              {["slot_start", "patient", "doctor", "status"].map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button variant="secondary" disabled={exporting || !list.data?.total} onClick={() => void exportExcel()}>
          <Download aria-hidden />
          {exporting ? t("exporting") : t("export")}
        </Button>
      </div>
      {list.isError && <p className="text-bad-text">{t("rangeTooWide")}</p>}
      <Table>
        <THead>
          <tr>
            <TH>{t("col.when")}</TH>
            <TH>{t("col.patient")}</TH>
            <TH>{t("col.doctor")}</TH>
            <TH>{t("col.status")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={5}>{c("loading")}</EmptyRow>}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={5}>{t("none")}</EmptyRow>}
          {list.data?.rows.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap tabular-nums">
                {r.slot_start ? `${formatDate(new Date(r.slot_start))} ${formatTime(new Date(r.slot_start))}` : t("walkInQueue", { n: r.queue_no ?? 0 })}
              </TD>
              <TD>
                <span className="font-medium">{r.patient}</span>
                <span className="block text-[0.9rem] text-text-secondary">{[r.uhid, r.phone].filter(Boolean).join(" · ")}</span>
              </TD>
              <TD>{r.doctor ?? "—"}</TD>
              <TD>
                <ApptStatusBadge status={r.status} />
              </TD>
              <TD className="text-right">
                <AppointmentActions appt={r} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />}
    </div>
  );
}
