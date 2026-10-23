"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { formatDateTime, istDayStart } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, PageHeader, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { newId, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";

interface Schedule {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number | null;
  capacity: number | null;
  valid_from: string;
  valid_to: string | null;
}
interface Leave {
  id: string;
  during: string;
  reason: string | null;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const hhmm = (time: string) => time.slice(0, 5);

/** "[\"2030-01-10 00:00:00+00\",\"2030-01-12 00:00:00+00\")" → two Dates */
function parseRange(range: string): [Date, Date] {
  const [from, to] = range.replace(/[[\]()"]/g, "").split(",");
  return [new Date(from!.trim().replace(" ", "T")), new Date(to!.trim().replace(" ", "T"))];
}

export function DoctorHours({ doctorId, doctorName }: { doctorId: string; doctorName: string }) {
  const t = useTranslations("doctorHours");
  const c = useTranslations("common");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const db = getSupabaseBrowser();

  const schedules = useQuery({
    queryKey: ["doctor_schedules", doctorId],
    queryFn: async () =>
      unwrap(
        await db
          .from("doctor_schedules")
          .select("id, weekday, start_time, end_time, slot_minutes, capacity, valid_from, valid_to")
          .eq("doctor_id", doctorId)
          .order("weekday")
          .order("start_time")
          .limit(100),
      ) as Schedule[],
  });
  const leaves = useQuery({
    queryKey: ["doctor_leaves", doctorId],
    // Upcoming and current leaves only; the audit log keeps the history.
    queryFn: async () =>
      unwrap(
        await db
          .from("doctor_leaves")
          .select("id, during, reason")
          .eq("doctor_id", doctorId)
          // not ended yet = not strictly left of [now, ∞)
          .not("during", "sl", `[${new Date().toISOString()},)`)
          .order("during")
          .limit(100),
      ) as Leave[],
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["doctor_schedules", doctorId] });
    void queryClient.invalidateQueries({ queryKey: ["doctor_leaves", doctorId] });
  };
  const remove = useMutation({
    mutationFn: async ({ table, id }: { table: "doctor_schedules" | "doctor_leaves"; id: string }) =>
      unwrap(await db.from(table).delete().eq("id", id).select("id")),
    onSuccess: () => {
      saved(t("removed"));
      refresh();
    },
    onError: failed,
  });

  const [hours, setHours] = useState({ weekday: "1", start: "10:00", end: "13:00", slot: "", capacity: "" });
  const addHours = useMutation({
    mutationFn: async () =>
      unwrap(
        await db.from("doctor_schedules").insert({
          id: newId(),
          doctor_id: doctorId,
          weekday: Number(hours.weekday),
          start_time: hours.start,
          end_time: hours.end,
          slot_minutes: hours.slot ? Number(hours.slot) : null,
          capacity: hours.capacity ? Number(hours.capacity) : null,
        }).select("id"),
      ),
    onSuccess: () => {
      saved();
      refresh();
    },
    onError: failed,
  });

  const [leave, setLeave] = useState({ from: "", to: "", reason: "" });
  const addLeave = useMutation({
    mutationFn: async () => {
      // Whole days in IST: from the start of the first day to the end of the last day.
      const from = istDayStart(leave.from);
      const to = new Date(istDayStart(leave.to).getTime() + 24 * 3600 * 1000);
      return unwrap(
        await db.from("doctor_leaves").insert({
          id: newId(),
          doctor_id: doctorId,
          during: `[${from.toISOString()},${to.toISOString()})`,
          reason: leave.reason.trim() || null,
        }).select("id"),
      );
    },
    onSuccess: () => {
      saved();
      setLeave({ from: "", to: "", reason: "" });
      refresh();
    },
    onError: failed,
  });

  function submitHours(e: FormEvent) {
    e.preventDefault();
    addHours.mutate();
  }
  function submitLeave(e: FormEvent) {
    e.preventDefault();
    if (!leave.from || !leave.to || leave.to < leave.from) return failed("invalid_input");
    addLeave.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-2">
          <Link href="/admin/libraries/doctors">
            <ArrowLeft aria-hidden />
            {t("back")}
          </Link>
        </Button>
        <PageHeader title={t("title", { name: doctorName })} description={t("description")} />
      </div>

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("weeklyHours")}</CardTitle>
        <Table>
          <THead>
            <tr>
              <TH>{t("day")}</TH>
              <TH>{t("from")}</TH>
              <TH>{t("to")}</TH>
              <TH>{t("slot")}</TH>
              <TH>{t("capacity")}</TH>
              <TH className="text-right">
                <span className="sr-only">{c("actions")}</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {schedules.data?.length === 0 && <EmptyRow colSpan={6}>{t("noHours")}</EmptyRow>}
            {schedules.data?.map((s) => (
              <TR key={s.id}>
                <TD>{t(`weekday.${s.weekday}`)}</TD>
                <TD>{hhmm(s.start_time)}</TD>
                <TD>{hhmm(s.end_time)}</TD>
                <TD>{s.slot_minutes ? t("minutes", { n: s.slot_minutes }) : t("default")}</TD>
                <TD>{s.capacity ?? t("default")}</TD>
                <TD className="text-right">
                  <Button variant="ghost" onClick={() => remove.mutate({ table: "doctor_schedules", id: s.id })}>
                    <Trash2 aria-hidden />
                    {c("remove")}
                  </Button>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        <form onSubmit={submitHours} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
          <Field label={t("day")}>
            {(a) => (
              <Select {...a} value={hours.weekday} onChange={(e) => setHours({ ...hours, weekday: e.target.value })}>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {t(`weekday.${d}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("from")}>
            {(a) => <Input {...a} type="time" required value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} />}
          </Field>
          <Field label={t("to")}>
            {(a) => <Input {...a} type="time" required value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} />}
          </Field>
          <Field label={t("slot")}>
            {(a) => (
              <Input {...a} type="number" min={5} max={240} placeholder={t("default")} value={hours.slot}
                onChange={(e) => setHours({ ...hours, slot: e.target.value })} />
            )}
          </Field>
          <Field label={t("capacity")}>
            {(a) => (
              <Input {...a} type="number" min={1} max={50} placeholder={t("default")} value={hours.capacity}
                onChange={(e) => setHours({ ...hours, capacity: e.target.value })} />
            )}
          </Field>
          <Button type="submit" disabled={addHours.isPending}>
            <Plus aria-hidden />
            {t("addHours")}
          </Button>
        </form>
        <CardDescription>{t("overlapHint")}</CardDescription>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("leave")}</CardTitle>
        <Table>
          <THead>
            <tr>
              <TH>{t("from")}</TH>
              <TH>{t("to")}</TH>
              <TH>{t("reason")}</TH>
              <TH className="text-right">
                <span className="sr-only">{c("actions")}</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {leaves.data?.length === 0 && <EmptyRow colSpan={4}>{t("noLeave")}</EmptyRow>}
            {leaves.data?.map((l) => {
              const [from, to] = parseRange(l.during);
              return (
                <TR key={l.id}>
                  <TD>{formatDateTime(from)}</TD>
                  <TD>{formatDateTime(to)}</TD>
                  <TD>{l.reason ?? "—"}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" onClick={() => remove.mutate({ table: "doctor_leaves", id: l.id })}>
                      <Trash2 aria-hidden />
                      {c("remove")}
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        <form onSubmit={submitLeave} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label={t("firstDay")}>
            {(a) => <Input {...a} type="date" required value={leave.from} onChange={(e) => setLeave({ ...leave, from: e.target.value })} />}
          </Field>
          <Field label={t("lastDay")}>
            {(a) => <Input {...a} type="date" required value={leave.to} onChange={(e) => setLeave({ ...leave, to: e.target.value })} />}
          </Field>
          <Field label={t("reason")}>
            {(a) => <Input {...a} maxLength={300} value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} />}
          </Field>
          <Button type="submit" disabled={addLeave.isPending}>
            <Plus aria-hidden />
            {t("addLeave")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
