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
import { useFeedback } from "@/lib/use-feedback";
import { SlotPicker } from "./appointment-actions";

export const APPT_TYPES = ["consultation", "session", "procedure", "surgery", "follow_up", "review"] as const;

/** Book: patient + doctor + day + slot (places left shown) + type. The database enforces capacity. */
export function BookDialog({
  doctor: initialDoctor = null,
  date: initialDate,
  slot: initialSlot = null,
  patient: initialPatient = null,
  session,
  onDone,
}: {
  doctor?: LibraryItem | null;
  date?: string;
  slot?: string | null;
  patient?: PatientHit | null;
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

  const book = useMutation({
    mutationFn: () =>
      rpc("book_appointment", {
        p_booking: {
          patient_id: patient!.id,
          doctor_id: doctor!.id,
          slot_start: slot,
          type,
          notes,
          confirm,
          ...(session ? { treatment_id: session.treatmentId, session_id: session.sessionId } : {}),
        },
        p_client_id: clientId,
      }),
    onSuccess: () => {
      saved(t("booked", { when: formatDateTime(new Date(slot!)) }));
      for (const key of ["slot_board", "today_board", "appointments_table", "patient_appointments", "free_slots", "patient_treatments", "sessions_due"]) {
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
        <Button disabled={!patient || !doctor || !slot || book.isPending} onClick={() => book.mutate()}>
          <CalendarPlus aria-hidden />
          {book.isPending ? t("booking") : t("book")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("patient")} className="min-w-64 flex-1">
            {(a) => <PatientPicker id={a.id} value={patient} onChange={setPatient} />}
          </Field>
          <Button asChild variant="ghost">
            <Link href="/patients/new" target="_blank">
              <UserPlus aria-hidden />
              {t("newPatient")}
            </Link>
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("doctor")}>{(a) => <LibraryCombobox id={a.id} kind="doctor" value={doctor} onChange={(d) => (setDoctor(d), setSlot(null))} />}</Field>
          <Field label={t("date")}>{(a) => <Input {...a} type="date" value={date} onChange={(e) => (setDate(e.target.value), setSlot(null))} />}</Field>
          <Field label={t("type")}>
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
        <SlotPicker doctorId={doctor?.id ?? null} date={date} value={slot} onChange={setSlot} />
        <Field label={t("notes")}>{(a) => <Textarea {...a} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
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
  const walkIn = useMutation({
    mutationFn: () =>
      rpc<{ queued: boolean; queue_no: number | null }>("book_walk_in", {
        p_patient_id: patient!.id,
        p_doctor_id: doctor?.id ?? null,
        p_notes: notes || null,
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
        <Button disabled={!patient || walkIn.isPending} onClick={() => walkIn.mutate()}>
          <CalendarPlus aria-hidden />
          {t("walkInButton")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("patient")} className="min-w-64 flex-1">
            {(a) => <PatientPicker id={a.id} value={patient} onChange={setPatient} />}
          </Field>
          <Button asChild variant="ghost">
            <Link href="/patients/new" target="_blank">
              <UserPlus aria-hidden />
              {t("newPatient")}
            </Link>
          </Button>
        </div>
        <Field label={t("doctorOptional")}>{(a) => <LibraryCombobox id={a.id} kind="doctor" value={doctor} onChange={setDoctor} />}</Field>
        <Field label={t("notes")}>{(a) => <Input {...a} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </DialogContent>
  );
}
