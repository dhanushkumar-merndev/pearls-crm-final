"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, CirclePlus, Pencil, Play, Save, Trash2, Undo2, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { z } from "zod";
import { toast } from "sonner";
import { formatDate, formatINR, formatTime, istDateString } from "@pearl/shared";
import { BookDialog } from "@/components/appointments/book-dialog";
import { MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import type { PatientHit } from "@/components/patients/patient-picker";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { newId, rpc } from "@/lib/rpc";
import { editTreatmentSchema, removeSessionSchema, startTreatmentSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import type { StatusKind } from "@pearl/shared";

type SessionStatus = "planned" | "booked" | "done" | "missed" | "skipped";
type TreatmentStatus = "active" | "on_hold" | "completed" | "closed" | "cancelled";
interface Session {
  id: string;
  seq: number;
  planned_date: string;
  actual_date: string | null;
  status: SessionStatus;
  appointment_id: string | null;
  slot_start: string | null;
}
export interface Treatment {
  id: string;
  name: string;
  status: TreatmentStatus;
  category: string;
  doctor_id: string | null;
  doctor: string | null;
  start_date: string;
  planned_sessions: number;
  gap_days: number[];
  pricing: "package" | "per_session";
  package_price_paise: number;
  agreed_price_paise: number | null;
  follow_up_days: number | null;
  notes: string | null;
  version: number;
  sessions: Session[];
  done_count: number;
}

const SESSION_KIND: Record<SessionStatus, StatusKind> = { planned: "warning", booked: "good", done: "good", missed: "critical", skipped: "serious" };
const TREATMENT_KIND: Record<TreatmentStatus, StatusKind> = { active: "good", on_hold: "warning", completed: "good", closed: "serious", cancelled: "serious" };

/** Patient file → Treatments: parallel treatments, each with its planned sessions. */
export function TreatmentsTab({ patient }: { patient: PatientHit }) {
  const t = useTranslations("treatments");
  const [starting, setStarting] = useState(false);
  const list = useQuery({
    queryKey: ["patient_treatments", patient.id],
    queryFn: () => rpc<Treatment[]>("patient_treatments_list", { p_patient_id: patient.id }),
  });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setStarting(true)}>
          <Play aria-hidden />
          {t("start")}
        </Button>
      </div>
      {list.isPending && <RowSkeletons rows={3} />}
      {list.data?.length === 0 && <p className="text-text-secondary">{t("none")}</p>}
      {list.data?.map((tr) => <TreatmentCard key={tr.id} treatment={tr} patient={patient} />)}
      <Dialog open={starting} onOpenChange={setStarting}>
        {starting && <StartDialog patient={patient} onDone={() => setStarting(false)} />}
      </Dialog>
    </div>
  );
}

function TreatmentCard({ treatment: tr, patient }: { treatment: Treatment; patient: PatientHit }) {
  const t = useTranslations("treatments");
  const queryClient = useQueryClient();
  const { failed } = useFeedback();
  const [dialog, setDialog] = useState<{ kind: "edit" } | { kind: "remove"; session: Session } | { kind: "book"; session: Session } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["patient_treatments", patient.id] });
    void queryClient.invalidateQueries({ queryKey: ["sessions_due"] });
    void queryClient.invalidateQueries({ queryKey: ["patient_appointments", patient.id] });
  };
  const setStatus = useMutation({
    mutationFn: ({ session, status }: { session: Session; status: SessionStatus }) =>
      rpc<{ book_next: { session_id: string; seq: number; suggested_date: string } | null }>("set_session_status", {
        p_session_id: session.id,
        p_status: status,
      }),
    onSuccess: (res, v) => {
      refresh();
      const next = res.book_next ? tr.sessions.find((s) => s.id === res.book_next!.session_id) : null;
      if (v.status === "done" && next) {
        toast.success(t("doneBookNext", { n: next.seq }), {
          action: { label: t("bookNext"), onClick: () => setDialog({ kind: "book", session: next }) },
          duration: 12_000,
        });
      } else toast.success(t(`sessionMarked.${v.status}`));
    },
    onError: failed,
  });
  const addSession = useMutation({
    mutationFn: () => rpc("add_session", { p_treatment_id: tr.id }),
    onSuccess: refresh,
    onError: failed,
  });
  const open = tr.status === "active" || tr.status === "on_hold";
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <CardTitle>{tr.name}</CardTitle>
          <p className="text-text-secondary">
            {[
              t("progress", { done: tr.done_count, total: tr.sessions.filter((s) => s.status !== "skipped").length }),
              tr.doctor,
              t(tr.pricing === "package" ? "packagePrice" : "perSession", { price: formatINR(tr.package_price_paise) }),
              tr.agreed_price_paise !== null ? t("agreed", { price: formatINR(tr.agreed_price_paise) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <StatusBadge kind={TREATMENT_KIND[tr.status]} label={t(`status.${tr.status}`)} />
        <Button variant="secondary" onClick={() => setDialog({ kind: "edit" })}>
          <Pencil aria-hidden />
          {t("edit")}
        </Button>
      </div>
      <ol className="flex flex-col gap-1.5">
        {tr.sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2">
            <span className="w-24 font-medium">{t("sessionN", { n: s.seq })}</span>
            <span className="min-w-36 flex-1 text-text-secondary">
              {s.status === "done" && s.actual_date
                ? t("doneOn", { date: formatDate(new Date(s.actual_date)) })
                : s.slot_start
                  ? t("bookedFor", { date: formatDate(new Date(s.slot_start)), time: formatTime(new Date(s.slot_start)) })
                  : t("plannedFor", { date: formatDate(new Date(s.planned_date)) })}
            </span>
            <StatusBadge kind={SESSION_KIND[s.status]} label={t(`session.${s.status}`)} />
            {open && (s.status === "planned" || s.status === "missed") && (
              <Button variant="ghost" onClick={() => setDialog({ kind: "book", session: s })}>
                <CalendarPlus aria-hidden />
                {t("book")}
              </Button>
            )}
            {open && (s.status === "planned" || s.status === "missed" || s.status === "booked") && (
              <Button variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ session: s, status: "done" })}>
                <Check aria-hidden />
                {t("markDone")}
              </Button>
            )}
            {open && s.status === "planned" && (
              <Button variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ session: s, status: "missed" })}>
                <UserX aria-hidden />
                {t("markMissed")}
              </Button>
            )}
            {open && s.status === "missed" && (
              <Button variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ session: s, status: "planned" })}>
                <Undo2 aria-hidden />
                {t("backToPlanned")}
              </Button>
            )}
            {open && (s.status === "planned" || s.status === "missed") && (
              <Button variant="ghost" onClick={() => setDialog({ kind: "remove", session: s })}>
                <Trash2 aria-hidden />
                {t("remove")}
              </Button>
            )}
          </li>
        ))}
      </ol>
      {open && (
        <Button variant="ghost" className="self-start" disabled={addSession.isPending} onClick={() => addSession.mutate()}>
          <CirclePlus aria-hidden />
          {t("addSession")}
        </Button>
      )}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog?.kind === "edit" && <EditDialog treatment={tr} onDone={() => (setDialog(null), refresh())} />}
        {dialog?.kind === "remove" && <RemoveDialog session={dialog.session} onDone={() => (setDialog(null), refresh())} />}
        {dialog?.kind === "book" && (
          <BookDialog
            patient={patient}
            doctor={tr.doctor_id ? { id: tr.doctor_id, label: tr.doctor ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null}
            date={dialog.session.planned_date < istDateString(new Date()) ? istDateString(new Date()) : dialog.session.planned_date}
            session={{ treatmentId: tr.id, sessionId: dialog.session.id, label: `${tr.name} — ${t("sessionN", { n: dialog.session.seq })}` }}
            onDone={() => (setDialog(null), refresh())}
          />
        )}
      </Dialog>
    </Card>
  );
}


function StartDialog({ patient, onDone }: { patient: PatientHit; onDone: () => void }) {
  const t = useTranslations("treatments");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [template, setTemplate] = useState<LibraryItem | null>(null);
  const [doctor, setDoctor] = useState<LibraryItem | null>(null);
  const [form, setForm] = useState({ name: "", sessions: "1", gaps: "0", pricing: "package", start: istDateString(new Date()), notes: "" });
  const [price, setPrice] = useState<number | null>(0);
  const [agreedTyped, setAgreed] = useState<number | null>(null);
  const [agreedTouched, setAgreedTouched] = useState(false);
  const [clientId] = useState(newId);
  // The price sales agreed with the patient (their lead's "Amount finalised") starts the agreed price.
  const leads = useQuery({
    queryKey: ["patient_leads", patient.id],
    queryFn: () =>
      rpc<{ id: string; sl_no: number; stage: string; amount_finalised_paise: number | null; finalised_by_name: string | null }[]>(
        "patient_leads",
        { p_patient_id: patient.id },
      ),
  });
  const fromSales = leads.data?.find((l) => l.amount_finalised_paise !== null && l.stage !== "converted" && l.stage !== "junk") ?? null;
  const agreed = agreedTouched ? agreedTyped : (agreedTyped ?? fromSales?.amount_finalised_paise ?? null);
  function chooseTemplate(item: LibraryItem | null) {
    setTemplate(item);
    if (!item) return;
    const d = item.defaults as { sessions?: number; gap_days?: number[]; pricing?: string; price_paise?: number };
    setForm((f) => ({ ...f, name: item.label, sessions: String(d.sessions ?? 1), gaps: (d.gap_days ?? [0]).join(", "), pricing: d.pricing ?? "package" }));
    setPrice(d.price_paise ?? 0);
  }
  const checks = useZodForm(startTreatmentSchema);
  const setField = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    checks.clear(key);
  };
  const start = useMutation({
    mutationFn: (d: z.output<typeof startTreatmentSchema>) =>
      rpc("start_treatment", {
        p_treatment: {
          patient_id: patient.id,
          template_id: d.template,
          name: d.name,
          doctor_id: d.doctor,
          start_date: d.start,
          sessions: d.sessions,
          gap_days: d.gaps,
          pricing: d.pricing,
          price_paise: d.price,
          agreed_price_paise: d.agreed,
          notes: d.notes,
        },
        p_client_id: clientId,
      }),
    onSuccess: () => {
      saved(t("started"));
      void queryClient.invalidateQueries({ queryKey: ["patient_treatments", patient.id] });
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      wide
      title={t("startTitle", { name: patient.title })}
      footer={
        <Button
          disabled={start.isPending}
          onClick={() => {
            const d = checks.validate({ ...form, template, doctor, price, agreed });
            if (d) start.mutate(d);
          }}
        >
          <Play aria-hidden />
          {t("start")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("template")} hint={t("templateHint")} error={checks.error("template")} className="sm:col-span-2">
          {(a) => <LibraryCombobox {...a} kind="treatment_template" allowCreate value={template} onChange={(v) => (chooseTemplate(v), checks.clearAll())} />}
        </Field>
        <Field label={t("name")} error={checks.error("name")}>
          {(a) => <Input {...a} maxLength={200} value={form.name} onChange={(e) => setField("name", e.target.value)} />}
        </Field>
        <Field label={t("doctor")} error={checks.error("doctor")}>
          {(a) => <LibraryCombobox {...a} kind="doctor" value={doctor} onChange={setDoctor} />}
        </Field>
        <Field label={t("startDate")} error={checks.error("start")}>
          {(a) => <Input {...a} type="date" value={form.start} onChange={(e) => setField("start", e.target.value)} />}
        </Field>
        <Field label={t("sessions")} error={checks.error("sessions")}>
          {(a) => <Input {...a} type="number" min={1} max={100} value={form.sessions} onChange={(e) => setField("sessions", e.target.value)} />}
        </Field>
        <Field label={t("gaps")} hint={t("gapsHint")} error={checks.error("gaps")} className="sm:col-span-2">
          {(a) => <Input {...a} inputMode="numeric" value={form.gaps} onChange={(e) => setField("gaps", e.target.value)} />}
        </Field>
        <Field label={t("pricing")} error={checks.error("pricing")}>
          {(a) => (
            <Select {...a} value={form.pricing} onChange={(e) => setField("pricing", e.target.value)}>
              <option value="package">{t("pricingPackage")}</option>
              <option value="per_session">{t("pricingPerSession")}</option>
            </Select>
          )}
        </Field>
        <Field label={t("price")} error={checks.error("price")}>{(a) => <MoneyInput {...a} value={price} onChange={(v) => (setPrice(v), checks.clear("price"))} />}</Field>
        <Field
          label={t("agreedPrice")}
          hint={
            fromSales
              ? t("agreedFromSales", { amount: formatINR(fromSales.amount_finalised_paise!), n: fromSales.sl_no, by: fromSales.finalised_by_name ?? "—" })
              : t("agreedHint")
          }
          error={checks.error("agreed")}
        >
          {(a) => <MoneyInput {...a} value={agreed} onChange={(v) => (setAgreed(v), setAgreedTouched(true), checks.clear("agreed"))} />}
        </Field>
        <Field label={t("notes")} error={checks.error("notes")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={4000} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />}
        </Field>
      </div>
    </DialogContent>
  );
}

function EditDialog({ treatment: tr, onDone }: { treatment: Treatment; onDone: () => void }) {
  const t = useTranslations("treatments");
  const { saved, failed } = useFeedback();
  const [doctor, setDoctor] = useState<LibraryItem | null>(
    tr.doctor_id ? { id: tr.doctor_id, label: tr.doctor ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null,
  );
  const [form, setForm] = useState({ name: tr.name, gaps: tr.gap_days.join(", "), status: tr.status, notes: tr.notes ?? "", reason: "" });
  const [price, setPrice] = useState<number | null>(tr.package_price_paise);
  const [agreed, setAgreed] = useState<number | null>(tr.agreed_price_paise);
  const priceChanged = price !== tr.package_price_paise || agreed !== tr.agreed_price_paise;
  const closing = form.status === "closed" || form.status === "cancelled";
  const [schema] = useState(() => editTreatmentSchema(tr));
  const checks = useZodForm(schema);
  const setField = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    checks.clear(key);
  };
  const save = useMutation({
    mutationFn: (d: z.output<typeof schema>) => {
      const patch: Record<string, unknown> = { name: d.name, status: d.status, notes: d.notes, doctor_id: d.doctor };
      if (d.gaps.join(",") !== tr.gap_days.join(",")) patch.gap_days = d.gaps;
      if (d.price !== tr.package_price_paise) patch.price_paise = d.price;
      if (d.agreed !== tr.agreed_price_paise) patch.agreed_price_paise = d.agreed;
      return rpc("update_treatment", { p_id: tr.id, p_patch: patch, p_version: tr.version, p_reason: d.reason });
    },
    onSuccess: () => {
      saved();
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      wide
      title={t("editTitle", { name: tr.name })}
      description={t("editHint")}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ ...form, doctor, price, agreed });
            if (d) save.mutate(d);
          }}
        >
          <Save aria-hidden />
          {t("save")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")} error={checks.error("name")}>
          {(a) => <Input {...a} maxLength={200} value={form.name} onChange={(e) => setField("name", e.target.value)} />}
        </Field>
        <Field label={t("doctor")} error={checks.error("doctor")}>{(a) => <LibraryCombobox {...a} kind="doctor" value={doctor} onChange={setDoctor} />}</Field>
        <Field label={t("gaps")} hint={t("replanHint")} error={checks.error("gaps")} className="sm:col-span-2">
          {(a) => <Input {...a} inputMode="numeric" value={form.gaps} onChange={(e) => setField("gaps", e.target.value)} />}
        </Field>
        <Field label={t("price")} error={checks.error("price")}>{(a) => <MoneyInput {...a} value={price} onChange={(v) => (setPrice(v), checks.clear("price"))} />}</Field>
        <Field label={t("agreedPrice")} error={checks.error("agreed")}>
          {(a) => <MoneyInput {...a} value={agreed} onChange={(v) => (setAgreed(v), checks.clear("agreed"))} />}
        </Field>
        <Field label={t("statusLabel")} error={checks.error("status")}>
          {(a) => (
            <Select {...a} value={form.status} onChange={(e) => setField("status", e.target.value as TreatmentStatus)}>
              {(["active", "on_hold", "completed", "closed", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("reason")} hint={priceChanged || closing ? t("reasonNeeded") : t("reasonOptional")} error={checks.error("reason")}>
          {(a) => <Input {...a} maxLength={300} value={form.reason} onChange={(e) => setField("reason", e.target.value)} />}
        </Field>
        <Field label={t("notes")} error={checks.error("notes")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={4000} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />}
        </Field>
      </div>
    </DialogContent>
  );
}

function RemoveDialog({ session, onDone }: { session: Session; onDone: () => void }) {
  const t = useTranslations("treatments");
  const { saved, failed } = useFeedback();
  const [reason, setReason] = useState("");
  const checks = useZodForm(removeSessionSchema);
  const remove = useMutation({
    mutationFn: (r: string) => rpc("remove_session", { p_session_id: session.id, p_reason: r }),
    onSuccess: () => {
      saved(t("removed"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("removeTitle", { n: session.seq })}
      footer={
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            const d = checks.validate({ reason });
            if (d) remove.mutate(d.reason);
          }}
        >
          <Trash2 aria-hidden />
          {t("remove")}
        </Button>
      }
    >
      <Field label={t("reason")} error={checks.error("reason")}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
      </Field>
    </DialogContent>
  );
}
