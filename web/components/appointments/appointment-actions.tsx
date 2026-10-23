"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, CircleCheck, CircleX, DoorOpen, MessageCircle, Stethoscope, UserRound, UserX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { formatDate, formatTime, istDateString } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { newId, rpc } from "@/lib/rpc";
import { useMe } from "@/lib/use-me";
import { useFeedback } from "@/lib/use-feedback";
import { waLink } from "@/lib/whatsapp";
import { NEXT, type ApptStatus } from "./status";

export interface ApptCard {
  id: string;
  status: ApptStatus;
  slot_start: string | null;
  doctor_id: string | null;
  doctor?: string | null;
  patient_id: string | null;
  patient: string | null;
  uhid: string | null;
  phone: string | null;
  version: number;
  is_walk_in: boolean;
  queue_no: number | null;
}

const ICONS: Partial<Record<ApptStatus, ReactNode>> = {
  confirmed: <CircleCheck aria-hidden />,
  arrived: <DoorOpen aria-hidden />,
  with_doctor: <Stethoscope aria-hidden />,
  done: <CircleCheck aria-hidden />,
  no_show: <UserX aria-hidden />,
  cancelled: <CircleX aria-hidden />,
};

/** "Actions ▾" for one appointment: next status, reschedule, WhatsApp, open patient. */
export function AppointmentActions({ appt, onChanged }: { appt: ApptCard; onChanged?: () => void }) {
  const t = useTranslations("appt");
  const me = useMe();
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [dialog, setDialog] = useState<"cancel" | "reschedule" | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["slot_board"] });
    void queryClient.invalidateQueries({ queryKey: ["today_board"] });
    void queryClient.invalidateQueries({ queryKey: ["appointments_table"] });
    void queryClient.invalidateQueries({ queryKey: ["patient_appointments"] });
    onChanged?.();
  };
  const setStatus = useMutation({
    mutationFn: ({ status, reason }: { status: ApptStatus; reason?: string }) =>
      rpc("set_appointment_status", { p_id: appt.id, p_status: status, p_reason: reason ?? null, p_version: appt.version }),
    onSuccess: (_d, v) => {
      saved(t(`done.${v.status}`));
      setDialog(null);
      refresh();
    },
    onError: failed,
  });
  const message = appt.slot_start
    ? t("waText", {
        name: appt.patient ?? "",
        clinic: me?.clinic.name ?? "",
        date: formatDate(new Date(appt.slot_start)),
        time: formatTime(new Date(appt.slot_start)),
        doctor: appt.doctor ?? "",
      })
    : "";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label={t("actionsFor", { name: appt.patient ?? "" })}>
            {t("actions")}
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {NEXT[appt.status]
            .filter((s) => s !== "cancelled")
            .map((s) => (
              <DropdownMenuItem key={s} disabled={setStatus.isPending} onSelect={() => setStatus.mutate({ status: s })}>
                {ICONS[s]}
                {t(`to.${s}`)}
              </DropdownMenuItem>
            ))}
          {["pending_confirmation", "confirmed", "no_show"].includes(appt.status) && appt.slot_start && (
            <DropdownMenuItem onSelect={() => setDialog("reschedule")}>
              <CalendarClock aria-hidden />
              {t("reschedule")}
            </DropdownMenuItem>
          )}
          {NEXT[appt.status].includes("cancelled") && (
            <DropdownMenuItem onSelect={() => setDialog("cancel")}>
              <CircleX aria-hidden />
              {t("to.cancelled")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {appt.phone && message && (
            <DropdownMenuItem asChild>
              <a href={waLink(appt.phone, message)} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden />
                {t("whatsapp")}
              </a>
            </DropdownMenuItem>
          )}
          {appt.patient_id && (
            <DropdownMenuItem asChild>
              <Link href={`/patients/${appt.patient_id}`}>
                <UserRound aria-hidden />
                {t("openPatient")}
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "cancel" && (
          <CancelDialog busy={setStatus.isPending} onCancel={(reason) => setStatus.mutate({ status: "cancelled", reason })} />
        )}
        {dialog === "reschedule" && <RescheduleDialog appt={appt} onDone={() => (setDialog(null), refresh())} />}
      </Dialog>
    </>
  );
}

function CancelDialog({ busy, onCancel }: { busy: boolean; onCancel: (reason: string) => void }) {
  const t = useTranslations("appt");
  const [reason, setReason] = useState("");
  return (
    <DialogContent
      title={t("cancelTitle")}
      footer={
        <Button variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => onCancel(reason.trim())}>
          <CircleX aria-hidden />
          {t("to.cancelled")}
        </Button>
      }
    >
      <Field label={t("reason")} hint={t("reasonHint")}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </DialogContent>
  );
}

export interface Slot {
  start: string;
  end: string;
  capacity: number;
  booked: number;
  left: number;
  blocked_reason: string | null;
}

/** Day + doctor → slot buttons with places left; blocked ones say why. */
export function SlotPicker({
  doctorId,
  date,
  value,
  onChange,
}: {
  doctorId: string | null;
  date: string;
  value: string | null;
  onChange: (start: string) => void;
}) {
  const t = useTranslations("appt");
  const slots = useQuery({
    queryKey: ["free_slots", doctorId, date],
    enabled: Boolean(doctorId && date),
    queryFn: () => rpc<Slot[]>("get_free_slots", { p_doctor_id: doctorId, p_date: date }),
  });
  if (!doctorId) return <p className="text-text-secondary">{t("pickDoctorFirst")}</p>;
  if (slots.isPending) return <p className="text-text-secondary">{t("loadingSlots")}</p>;
  const list = slots.data ?? [];
  if (list.length === 0) return <p className="text-text-secondary">{t("noHours")}</p>;
  const reason = list.find((s) => s.blocked_reason && s.blocked_reason !== "past")?.blocked_reason;
  return (
    <div className="flex flex-col gap-2">
      {reason && <p className="text-bad-text">{t(`blocked.${reason}`)}</p>}
      <div role="radiogroup" aria-label={t("slot")} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {list.map((s) => {
          const disabled = Boolean(s.blocked_reason) || s.left === 0;
          const selected = value === s.start;
          return (
            <button
              key={s.start}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(s.start)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl border px-2 text-base ${
                selected ? "border-foreground bg-primary text-primary-foreground" : "border-border bg-secondary hover:bg-popover-accent"
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span className="font-medium tabular-nums">{formatTime(new Date(s.start))}</span>
              <span className="text-[0.8rem]">{s.blocked_reason ? t(`blocked.${s.blocked_reason}`) : t("left", { n: s.left })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RescheduleDialog({ appt, onDone }: { appt: ApptCard; onDone: () => void }) {
  const t = useTranslations("appt");
  const { saved, failed } = useFeedback();
  const [doctor, setDoctor] = useState<LibraryItem | null>(
    appt.doctor_id ? { id: appt.doctor_id, label: appt.doctor ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null,
  );
  const [date, setDate] = useState(appt.slot_start ? istDateString(new Date(appt.slot_start)) : istDateString(new Date()));
  const [slot, setSlot] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [clientId] = useState(newId);
  const move = useMutation({
    mutationFn: () =>
      rpc("reschedule_appointment", { p_id: appt.id, p_new_start: slot, p_doctor_id: doctor?.id ?? null, p_reason: reason || null, p_client_id: clientId }),
    onSuccess: () => {
      saved(t("rescheduled"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      wide
      title={t("rescheduleTitle", { name: appt.patient ?? "" })}
      footer={
        <Button disabled={!slot || move.isPending} onClick={() => move.mutate()}>
          <CalendarClock aria-hidden />
          {t("moveHere")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("doctor")}>{(a) => <LibraryCombobox id={a.id} kind="doctor" value={doctor} onChange={(d) => (setDoctor(d), setSlot(null))} />}</Field>
          <Field label={t("date")}>{(a) => <Input {...a} type="date" value={date} onChange={(e) => (setDate(e.target.value), setSlot(null))} />}</Field>
        </div>
        <SlotPicker doctorId={doctor?.id ?? null} date={date} value={slot} onChange={setSlot} />
        <Field label={t("reason")}>{(a) => <Input {...a} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </DialogContent>
  );
}
