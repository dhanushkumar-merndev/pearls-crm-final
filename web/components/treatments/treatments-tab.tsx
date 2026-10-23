"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, CirclePlus, Pencil, Play, Save, Trash2, Undo2, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
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
  const c = useTranslations("common");
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
      {list.isPending && <p>{c("loading")}</p>}
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

const parseGaps = (text: string) => text.split(/[,\s]+/).filter(Boolean).map(Number);

function StartDialog({ patient, onDone }: { patient: PatientHit; onDone: () => void }) {
  const t = useTranslations("treatments");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [template, setTemplate] = useState<LibraryItem | null>(null);
  const [doctor, setDoctor] = useState<LibraryItem | null>(null);
  const [form, setForm] = useState({ name: "", sessions: "1", gaps: "0", pricing: "package", start: istDateString(new Date()), notes: "" });
  const [price, setPrice] = useState<number | null>(0);
  const [agreed, setAgreed] = useState<number | null>(null);
  const [clientId] = useState(newId);
  function chooseTemplate(item: LibraryItem | null) {
    setTemplate(item);
    if (!item) return;
    const d = item.defaults as { sessions?: number; gap_days?: number[]; pricing?: string; price_paise?: number };
    setForm((f) => ({ ...f, name: item.label, sessions: String(d.sessions ?? 1), gaps: (d.gap_days ?? [0]).join(", "), pricing: d.pricing ?? "package" }));
    setPrice(d.price_paise ?? 0);
  }
  const gaps = parseGaps(form.gaps);
  const valid = form.name.trim() && Number(form.sessions) >= 1 && gaps.length > 0 && gaps.every((g) => Number.isInteger(g) && g >= 0);
  const start = useMutation({
    mutationFn: () =>
      rpc("start_treatment", {
        p_treatment: {
          patient_id: patient.id,
          template_id: template?.id ?? null,
          name: form.name,
          doctor_id: doctor?.id ?? null,
          start_date: form.start,
          sessions: Number(form.sessions),
          gap_days: gaps,
          pricing: form.pricing,
          price_paise: price ?? 0,
          agreed_price_paise: agreed,
          notes: form.notes,
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
        <Button disabled={!valid || start.isPending} onClick={() => start.mutate()}>
          <Play aria-hidden />
          {t("start")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("template")} hint={t("templateHint")} className="sm:col-span-2">
          {(a) => <LibraryCombobox id={a.id} kind="treatment_template" allowCreate value={template} onChange={chooseTemplate} />}
        </Field>
        <Field label={t("name")}>{(a) => <Input {...a} maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label={t("doctor")}>{(a) => <LibraryCombobox id={a.id} kind="doctor" value={doctor} onChange={setDoctor} />}</Field>
        <Field label={t("startDate")}>{(a) => <Input {...a} type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />}</Field>
        <Field label={t("sessions")}>{(a) => <Input {...a} type="number" min={1} max={100} value={form.sessions} onChange={(e) => setForm({ ...form, sessions: e.target.value })} />}</Field>
        <Field label={t("gaps")} hint={t("gapsHint")} className="sm:col-span-2">
          {(a) => <Input {...a} inputMode="numeric" value={form.gaps} onChange={(e) => setForm({ ...form, gaps: e.target.value })} />}
        </Field>
        <Field label={t("pricing")}>
          {(a) => (
            <Select {...a} value={form.pricing} onChange={(e) => setForm({ ...form, pricing: e.target.value })}>
              <option value="package">{t("pricingPackage")}</option>
              <option value="per_session">{t("pricingPerSession")}</option>
            </Select>
          )}
        </Field>
        <Field label={t("price")}>{(a) => <MoneyInput {...a} value={price} onChange={setPrice} />}</Field>
        <Field label={t("agreedPrice")} hint={t("agreedHint")}>{(a) => <MoneyInput {...a} value={agreed} onChange={setAgreed} />}</Field>
        <Field label={t("notes")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={4000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
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
  const needsReason = (priceChanged || (closing && form.status !== tr.status)) && form.reason.trim().length < 3;
  const save = useMutation({
    mutationFn: () => {
      const gaps = parseGaps(form.gaps);
      const patch: Record<string, unknown> = { name: form.name, status: form.status, notes: form.notes, doctor_id: doctor?.id ?? null };
      if (gaps.join(",") !== tr.gap_days.join(",")) patch.gap_days = gaps;
      if (price !== tr.package_price_paise) patch.price_paise = price ?? 0;
      if (agreed !== tr.agreed_price_paise) patch.agreed_price_paise = agreed;
      return rpc("update_treatment", { p_id: tr.id, p_patch: patch, p_version: tr.version, p_reason: form.reason || null });
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
        <Button disabled={needsReason || save.isPending} onClick={() => save.mutate()}>
          <Save aria-hidden />
          {t("save")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")}>{(a) => <Input {...a} maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label={t("doctor")}>{(a) => <LibraryCombobox id={a.id} kind="doctor" value={doctor} onChange={setDoctor} />}</Field>
        <Field label={t("gaps")} hint={t("replanHint")} className="sm:col-span-2">
          {(a) => <Input {...a} inputMode="numeric" value={form.gaps} onChange={(e) => setForm({ ...form, gaps: e.target.value })} />}
        </Field>
        <Field label={t("price")}>{(a) => <MoneyInput {...a} value={price} onChange={setPrice} />}</Field>
        <Field label={t("agreedPrice")}>{(a) => <MoneyInput {...a} value={agreed} onChange={setAgreed} />}</Field>
        <Field label={t("statusLabel")}>
          {(a) => (
            <Select {...a} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TreatmentStatus })}>
              {(["active", "on_hold", "completed", "closed", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("reason")} hint={priceChanged || closing ? t("reasonNeeded") : t("reasonOptional")} error={needsReason ? t("reasonNeeded") : undefined}>
          {(a) => <Input {...a} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
        </Field>
        <Field label={t("notes")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={4000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
        </Field>
      </div>
    </DialogContent>
  );
}

function RemoveDialog({ session, onDone }: { session: Session; onDone: () => void }) {
  const t = useTranslations("treatments");
  const { saved, failed } = useFeedback();
  const [reason, setReason] = useState("");
  const remove = useMutation({
    mutationFn: () => rpc("remove_session", { p_session_id: session.id, p_reason: reason }),
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
        <Button variant="danger" disabled={reason.trim().length < 3 || remove.isPending} onClick={() => remove.mutate()}>
          <Trash2 aria-hidden />
          {t("remove")}
        </Button>
      }
    >
      <Field label={t("reason")}>{(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </DialogContent>
  );
}
