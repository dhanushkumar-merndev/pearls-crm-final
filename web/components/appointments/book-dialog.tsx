"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDateTime, istDateString } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { PatientPicker, type PatientHit } from "@/components/patients/patient-picker";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { newId, rpc } from "@/lib/rpc";
import { APPT_TYPES, bookSchema, walkInSchema } from "@/lib/schemas/appointments";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { SlotPicker } from "./appointment-actions";

export { APPT_TYPES };

/**
 * Book: patient (or a lead not yet registered) + doctor + day + slot (places left shown) + type.
 * The database enforces capacity.
 */
export function BookDialog({
  doctor: initialDoctor = null,
  date: initialDate,
  slot: initialSlot = null,
  patient: initialPatient = null,
  lead,
  session,
  onDone,
}: {
  doctor?: LibraryItem | null;
  date?: string;
  slot?: string | null;
  patient?: PatientHit | null;
  /** Booking a consultation for a lead (sales): no patient file yet; reception registers on arrival. */
  lead?: { id: string; name: string };
  /** Booking a planned treatment session ("Book next session?"). */
  session?: { treatmentId: string; sessionId: string; label: string };
  onDone: () => void;
}) {
  const t = useTranslations("appt");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [patient, setPatient] = useState<PatientHit | null>(initialPatient);
  const [doctor, setDoctor] = useState<LibraryItem | null>(initialDoctor);
  const [date, setDate] = useState(initialDate ?? istDateString(new Date()));
  const [slot, setSlot] = useState<string | null>(initialSlot);
  const [type, setType] = useState<(typeof APPT_TYPES)[number]>(session ? "session" : "consultation");
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [clientId] = useState(newId);
  const checks = useZodForm(bookSchema);

  const book = useMutation({
    mutationFn: (d: { who: string; doctor: string; slot: string; type: string; notes: string | null; confirm: boolean }) =>
      rpc("book_appointment", {
        p_booking: {
          ...(lead ? { lead_id: d.who } : { patient_id: d.who }),
          doctor_id: d.doctor,
          slot_start: d.slot,
          type: d.type,
          notes: d.notes,
          confirm: d.confirm,
          ...(session ? { treatment_id: session.treatmentId, session_id: session.sessionId } : {}),
        },
        p_client_id: clientId,
      }),
    onSuccess: (_, d) => {
      saved(t("booked", { when: formatDateTime(new Date(d.slot)) }));
      for (const key of ["slot_board", "today_board", "appointments_table", "patient_appointments", "free_slots", "patient_treatments", "sessions_due", "lead_detail", "leads_table"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      onDone();
    },
    onError: (e) => {
      failed(e);
      void queryClient.invalidateQueries({ queryKey: ["free_slots"] }); // someone may have taken the place
    },
  });

  return (
    <DialogContent
      wide
      title={session ? t("bookSessionTitle", { what: session.label }) : t("bookTitle")}
      footer={
        <Button
          disabled={book.isPending}
          onClick={() => {
            const d = checks.validate({ who: lead ? { id: lead.id } : patient, doctor, date, slot, type, notes, confirm });
            if (d) book.mutate(d);
          }}
        >
          <CalendarPlus aria-hidden />
          {book.isPending ? t("booking") : t("book")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {lead ? (
          <p className="rounded-xl border border-border bg-secondary p-3">{t("forLead", { name: lead.name })}</p>
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            <Field label={t("patient")} error={checks.error("who")} className="min-w-64 flex-1">
              {(a) => <PatientPicker {...a} value={patient} onChange={(p) => (setPatient(p), checks.clear("who"))} />}
            </Field>
            <Button asChild variant="ghost" className="mt-7">
              <Link href="/patients/new" target="_blank">
                <UserPlus aria-hidden />
                {t("newPatient")}
              </Link>
            </Button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("doctor")} error={checks.error("doctor")}>
            {(a) => <LibraryCombobox {...a} kind="doctor" value={doctor} onChange={(d) => (setDoctor(d), setSlot(null), checks.clear("doctor"))} />}
          </Field>
          <Field label={t("date")} error={checks.error("date")}>
            {(a) => <Input {...a} type="date" value={date} onChange={(e) => (setDate(e.target.value), setSlot(null), checks.clear("date"))} />}
          </Field>
          <Field label={t("type")} error={checks.error("type")}>
            {(a) => (
              <Select {...a} value={type} onChange={(e) => setType(e.target.value as (typeof APPT_TYPES)[number])}>
                {APPT_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`types.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <SlotPicker doctorId={doctor?.id ?? null} date={date} value={slot} onChange={(v) => (setSlot(v), checks.clear("slot"))} error={checks.error("slot")} />
        <Field label={t("notes")} error={checks.error("notes")}>
          {(a) => <Textarea {...a} rows={2} maxLength={1000} value={notes} onChange={(e) => (setNotes(e.target.value), checks.clear("notes"))} />}
        </Field>
        <Checkbox label={t("confirmNow")} hint={t("confirmNowHint")} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
      </div>
    </DialogContent>
  );
}

/** Walk-in: into the doctor's current slot if there is room, otherwise the queue. */
export function WalkInDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("appt");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [doctor, setDoctor] = useState<LibraryItem | null>(null);
  const [notes, setNotes] = useState("");
  const [clientId] = useState(newId);
  const checks = useZodForm(walkInSchema);
  const walkIn = useMutation({
    mutationFn: (d: { patient: string; doctor: string | null; notes: string | null }) =>
      rpc<{ queued: boolean; queue_no: number | null }>("book_walk_in", {
        p_patient_id: d.patient,
        p_doctor_id: d.doctor,
        p_notes: d.notes,
        p_client_id: clientId,
      }),
    onSuccess: (r) => {
      saved(r.queued ? t("queued", { n: r.queue_no ?? 0 }) : t("walkInSlot"));
      void queryClient.invalidateQueries({ queryKey: ["today_board"] });
      void queryClient.invalidateQueries({ queryKey: ["slot_board"] });
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("walkInTitle")}
      description={t("walkInHint")}
      footer={
        <Button
          disabled={walkIn.isPending}
          onClick={() => {
            const d = checks.validate({ patient, doctor, notes });
            if (d) walkIn.mutate(d);
          }}
        >
          <CalendarPlus aria-hidden />
          {t("walkInButton")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-3">
          <Field label={t("patient")} error={checks.error("patient")} className="min-w-64 flex-1">
            {(a) => <PatientPicker {...a} value={patient} onChange={(p) => (setPatient(p), checks.clear("patient"))} />}
          </Field>
          <Button asChild variant="ghost" className="mt-7">
            <Link href="/patients/new" target="_blank">
              <UserPlus aria-hidden />
              {t("newPatient")}
            </Link>
          </Button>
        </div>
        <Field label={t("doctorOptional")} error={checks.error("doctor")}>
          {(a) => <LibraryCombobox {...a} kind="doctor" value={doctor} onChange={setDoctor} />}
        </Field>
        <Field label={t("notes")} error={checks.error("notes")}>
          {(a) => <Input {...a} maxLength={1000} value={notes} onChange={(e) => (setNotes(e.target.value), checks.clear("notes"))} />}
        </Field>
      </div>
    </DialogContent>
  );
}
