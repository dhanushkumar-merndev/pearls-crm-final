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
import { cancelSchema, rescheduleSchema } from "@/lib/schemas/appointments";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
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
  const checks = useZodForm(cancelSchema);
  return (
    <DialogContent
      title={t("cancelTitle")}
      footer={
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            const d = checks.validate({ reason });
            if (d) onCancel(d.reason);
          }}
        >
          <CircleX aria-hidden />
          {t("to.cancelled")}
        </Button>
      }
    >
      <Field label={t("reason")} hint={t("reasonHint")} error={checks.error("reason")}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
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
  error,
}: {
  doctorId: string | null;
  date: string;
  value: string | null;
  onChange: (start: string) => void;
  /** "Please choose a time slot." etc., shown under the slots. */
  error?: string;
}) {
  const t = useTranslations("appt");
  const errorEl = error ? (
    <p id="slot-error" role="alert" className="text-[0.95rem] text-bad-text">
      {error}
    </p>
  ) : null;
  const slots = useQuery({
    queryKey: ["free_slots", doctorId, date],
    enabled: Boolean(doctorId && date),
    queryFn: () => rpc<Slot[]>("get_free_slots", { p_doctor_id: doctorId, p_date: date }),
  });
  if (!doctorId) return <p className="text-text-secondary">{t("pickDoctorFirst")}</p>;
  if (slots.isPending) return <p className="text-text-secondary">{t("loadingSlots")}</p>;
  const list = slots.data ?? [];
  if (list.length === 0)
    return (
      <div className="flex flex-col gap-1">
        <p className="text-text-secondary">{t("noHours")}</p>
        {errorEl}
      </div>
    );
  const reason = list.find((s) => s.blocked_reason && s.blocked_reason !== "past")?.blocked_reason;
  return (
    <div className="flex flex-col gap-2">
      {reason && <p className="text-bad-text">{t(`blocked.${reason}`)}</p>}
      <div
        role="radiogroup"
        aria-label={t("slot")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "slot-error" : undefined}
        tabIndex={error ? -1 : undefined}
        className="grid grid-cols-3 gap-2 rounded-xl sm:grid-cols-4 aria-invalid:outline aria-invalid:outline-2 aria-invalid:outline-offset-4 aria-invalid:outline-status-critical"
      >
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
      {errorEl}
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
  const checks = useZodForm(rescheduleSchema);
  const move = useMutation({
    mutationFn: (d: { doctor: string; slot: string; reason: string | null }) =>
      rpc("reschedule_appointment", { p_id: appt.id, p_new_start: d.slot, p_doctor_id: d.doctor, p_reason: d.reason, p_client_id: clientId }),
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
        <Button
          disabled={move.isPending}
          onClick={() => {
            const d = checks.validate({ doctor, date, slot, reason });
            if (d) move.mutate(d);
          }}
        >
          <CalendarClock aria-hidden />
          {t("moveHere")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("doctor")} error={checks.error("doctor")}>
            {(a) => <LibraryCombobox {...a} kind="doctor" value={doctor} onChange={(d) => (setDoctor(d), setSlot(null), checks.clear("doctor"))} />}
          </Field>
          <Field label={t("date")} error={checks.error("date")}>
            {(a) => <Input {...a} type="date" value={date} onChange={(e) => (setDate(e.target.value), setSlot(null), checks.clear("date"))} />}
          </Field>
        </div>
        <SlotPicker doctorId={doctor?.id ?? null} date={date} value={slot} onChange={(v) => (setSlot(v), checks.clear("slot"))} error={checks.error("slot")} />
        <Field label={t("reason")} error={checks.error("reason")}>
          {(a) => <Input {...a} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
        </Field>
      </div>
    </DialogContent>
  );
}
