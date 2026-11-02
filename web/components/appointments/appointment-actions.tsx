"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, CircleCheck, CircleX, DoorOpen, FilePlus2, MessageCircle, RotateCcw, Stethoscope, UserPlus, UserRound, UserX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { formatDate, formatTime, istDateString } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { ScannerDialog } from "@/components/scan/scanner-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Textarea } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { newId, rpc } from "@/lib/rpc";
import { useMe } from "@/lib/use-me";
import { cancelSchema, rescheduleSchema } from "@/lib/schemas/appointments";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { waLink } from "@/lib/whatsapp";
import { NEXT, type ApptStatus } from "./status";

/** The patient's name on a booking; reception and admin can click it to open the patient file. */
export function ApptPatientName({ appt, className }: { appt: Pick<ApptCard, "patient" | "patient_id">; className?: string }) {
  const me = useMe();
  const reception = me?.role === "receptionist" || me?.role === "admin";
  if (!appt.patient_id || !reception) return <span className={className}>{appt.patient}</span>;
  return (
    <Link href={`/patients/${appt.patient_id}`} className={`${className ?? ""} underline-offset-4 hover:text-link hover:underline`}>
      {appt.patient}
    </Link>
  );
}

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
  /** A booking made for a lead who has no patient file yet (sales booked it). */
  lead_only?: boolean;
  lead_id?: string | null;
  lead_sl_no?: number | null;
  /** Cancelled by the system: nobody confirmed in time (staff call, then restore or leave it). */
  auto_cancelled?: boolean;
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
  const [dialog, setDialog] = useState<"cancel" | "keep" | "reschedule" | null>(null);
  const [scanning, setScanning] = useState(false);
  // Once the patient is here: the doctor's prescription is saved on this visit (and its treatment session).
  const visited = appt.status === "arrived" || appt.status === "with_doctor" || appt.status === "done";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["slot_board"] });
    void queryClient.invalidateQueries({ queryKey: ["today_board"] });
    void queryClient.invalidateQueries({ queryKey: ["appointments_table"] });
    void queryClient.invalidateQueries({ queryKey: ["patient_appointments"] });
    onChanged?.();
  };
  const setStatus = useMutation({
    mutationFn: ({ status, reason }: { status: ApptStatus; reason?: string; done?: "restore" | "keepCancelled" }) =>
      rpc("set_appointment_status", { p_id: appt.id, p_status: status, p_reason: reason ?? null, p_version: appt.version }),
    onSuccess: (_d, v) => {
      saved(t(`done.${v.done ?? v.status}`));
      setDialog(null);
      refresh();
    },
    onError: failed,
  });
  // Sales may only confirm, cancel or reschedule lead bookings (the database enforces it too).
  const sales = me?.role === "sales_manager" || me?.role === "sales_executive";
  const reception = me?.role === "receptionist" || me?.role === "admin";
  const next = NEXT[appt.status].filter((s) => !sales || s === "confirmed" || s === "cancelled");
  // Auto-cancelled: the server restores it on "confirm" if the slot is still free (and still ahead).
  const autoCancelled = appt.status === "cancelled" && !!appt.auto_cancelled && !!appt.slot_start;
  const canDecide = autoCancelled && (reception || (sales && !!appt.lead_id));
  const message = appt.slot_start
    ? t("waText", {
        name: appt.patient ?? "",
        clinic: me?.clinic.name ?? "",
        date: formatDate(new Date(appt.slot_start)),
        time: formatTime(new Date(appt.slot_start)),
        doctor: appt.doctor ?? "",
      })
    : "";
  // Reminder through the clinic's own WhatsApp (it shows in their chat). Only when the Cloud API is
  // off or this person is messaged by hand does it open WhatsApp with the text (and log it).
  const [reminderId, setReminderId] = useState(newId);
  const remind = useMutation({
    mutationFn: () =>
      rpc<{ manual: boolean; phone_e164: string; body: string }>("wa_send_reminder", {
        p_appointment_id: appt.id,
        p_text: message,
        p_client_id: reminderId,
      }),
    onSuccess: (r) => {
      setReminderId(newId());
      if (r.manual) {
        window.open(waLink(r.phone_e164, r.body), "_blank", "noopener,noreferrer");
        saved(t("reminderOpened"));
      } else saved(t("reminderSent"));
      void queryClient.invalidateQueries({ queryKey: ["wa_thread"] });
      void queryClient.invalidateQueries({ queryKey: ["wa_inbox"] });
    },
    onError: failed,
  });
  const canRemind = reception || (sales && !!appt.lead_only && !!appt.lead_id);

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
          {reception && appt.lead_only && appt.lead_id && (
            <DropdownMenuItem asChild>
              <Link href={`/patients/new?lead=${appt.lead_id}`}>
                <UserPlus aria-hidden />
                {t("registerLead")}
              </Link>
            </DropdownMenuItem>
          )}
          {canDecide && (
            <>
              <DropdownMenuItem
                disabled={setStatus.isPending}
                onSelect={() => setStatus.mutate({ status: "confirmed", done: "restore" })}
              >
                <RotateCcw aria-hidden />
                {t("to.restore")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("keep")}>
                <CircleX aria-hidden />
                {t("to.keepCancelled")}
              </DropdownMenuItem>
            </>
          )}
          {next
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
          {next.includes("cancelled") && (
            <DropdownMenuItem onSelect={() => setDialog("cancel")}>
              <CircleX aria-hidden />
              {t("to.cancelled")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {/* A reminder only makes sense before the visit: not once arrived, done, no-show or cancelled. */}
          {canRemind && appt.phone && message && (appt.status === "pending_confirmation" || appt.status === "confirmed") && (
            <DropdownMenuItem disabled={remind.isPending} onSelect={() => remind.mutate()}>
              <MessageCircle aria-hidden />
              {t("whatsapp")}
            </DropdownMenuItem>
          )}
          {appt.patient_id && reception && visited && (
            <DropdownMenuItem onSelect={() => setScanning(true)}>
              <FilePlus2 aria-hidden />
              {t("addPrescription")}
            </DropdownMenuItem>
          )}
          {appt.patient_id && reception && (
            <DropdownMenuItem asChild>
              <Link href={`/patients/${appt.patient_id}`}>
                <UserRound aria-hidden />
                {t("openPatient")}
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={scanning} onOpenChange={setScanning}>
        {scanning && appt.patient_id && (
          <ScannerDialog
            patientId={appt.patient_id}
            docFor={{
              links: { appointment_id: appt.id },
              label: [appt.patient, appt.doctor, appt.slot_start ? formatDate(new Date(appt.slot_start)) : null].filter(Boolean).join(" · "),
              date: appt.slot_start ? istDateString(new Date(appt.slot_start)) : null,
            }}
            onDone={() => setScanning(false)}
          />
        )}
      </Dialog>
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "cancel" && (
          <CancelDialog busy={setStatus.isPending} onCancel={(reason) => setStatus.mutate({ status: "cancelled", reason })} />
        )}
        {dialog === "keep" && (
          <CancelDialog
            keep
            busy={setStatus.isPending}
            onCancel={(reason) => setStatus.mutate({ status: "cancelled", reason, done: "keepCancelled" })}
          />
        )}
        {dialog === "reschedule" && <RescheduleDialog appt={appt} onDone={() => (setDialog(null), refresh())} />}
      </Dialog>
    </>
  );
}

/** Cancel with a reason; `keep`: the same for leaving an auto-cancelled booking cancelled. */
function CancelDialog({ busy, keep, onCancel }: { busy: boolean; keep?: boolean; onCancel: (reason: string) => void }) {
  const t = useTranslations("appt");
  const [reason, setReason] = useState("");
  const checks = useZodForm(cancelSchema);
  return (
    <DialogContent
      title={keep ? t("keepCancelledTitle") : t("cancelTitle")}
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
          {keep ? t("to.keepCancelled") : t("to.cancelled")}
        </Button>
      }
    >
      <Field label={t("reason")} hint={keep ? t("keepCancelledHint") : t("reasonHint")} error={checks.error("reason")}>
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
              className={`flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 text-base ${
                selected ? "border-foreground bg-primary text-primary-foreground" : "border-border bg-secondary hover:bg-popover-accent"
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span className="font-medium tabular-nums">{formatTime(new Date(s.start))}</span>
              <span className="text-[0.9rem]">{s.blocked_reason ? t(`blocked.${s.blocked_reason}`) : t("left", { n: s.left })}</span>
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
            {(a) => <DatePicker {...a} value={date} onChange={(v) => (setDate(v), setSlot(null), checks.clear("date"))} />}
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
