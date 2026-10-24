"use client";

import { useMutation } from "@tanstack/react-query";
import { IndianRupee, PhoneCall, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import {
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  editLeadSchema,
  formatINR,
  fromIstDateTimeLocal,
  logCallSchema,
  optionalPaise,
  optionalText,
  requiredReason,
} from "@pearl/shared";
import { MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import type { Lead } from "./types";

const item = (id: string | null, label: string | null): LibraryItem | null =>
  id ? { id, label: label ?? "", subtitle: null, on_the_fly: false, defaults: {} } : null;

/** Edit the lead's details (update_lead; the version guards against two people editing at once). */
export function EditLeadDialog({ lead, onDone }: { lead: Lead; onDone: (updated: Lead) => void }) {
  const t = useTranslations("leads");
  const { saved, failed } = useFeedback();
  const [f, setF] = useState({
    name: lead.name,
    phone: lead.phone_e164,
    alt_phone: lead.alt_phone_e164 ?? "",
    email: lead.email ?? "",
    treatment_text: lead.treatment_text ?? "",
    referred_by_text: lead.referred_by_text ?? "",
    appointment_mode: lead.appointment_mode ?? "",
    surgery_date: lead.surgery_date ?? "",
    comments1: lead.comments1 ?? "",
    comments2: lead.comments2 ?? "",
  });
  const [treatment, setTreatment] = useState(item(lead.treatment_template_id, lead.treatment));
  const [source, setSource] = useState(item(lead.source_id, lead.source_label));
  const [doctor, setDoctor] = useState(item(lead.doctor_id, lead.doctor_name));
  const [quoted, setQuoted] = useState<number | null>(lead.amount_quoted_paise);
  const checks = useZodForm(editLeadSchema);
  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    checks.clear(k);
  };
  const save = useMutation({
    mutationFn: (d: z.output<typeof editLeadSchema>) =>
      rpc<Lead>("update_lead", {
        p_id: lead.id,
        p_patch: {
          name: d.name,
          phone: d.phone,
          alt_phone: d.alt_phone,
          email: d.email,
          treatment_template_id: d.treatment,
          treatment_text: d.treatment ? null : d.treatment_text,
          source_id: d.source,
          doctor_id: d.doctor,
          referred_by_text: d.referred_by_text,
          appointment_mode: d.appointment_mode,
          surgery_date: d.surgery_date,
          amount_quoted_paise: d.amount_quoted_paise,
          comments1: d.comments1,
          comments2: d.comments2,
        },
        p_version: lead.version,
      }),
    onSuccess: (updated) => {
      saved();
      onDone(updated);
    },
    onError: (e) => {
      if (!checks.fromServer(e, { name: "name", phone: "phone", source_id: "source" })) failed(e);
    },
  });
  return (
    <DialogContent
      wide
      title={t("editTitle", { name: lead.name })}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ ...f, treatment, source, doctor, amount_quoted_paise: quoted });
            if (d) save.mutate(d);
          }}
        >
          <Save aria-hidden />
          {save.isPending ? t("saving") : t("saveChanges")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("f.name")} error={checks.error("name")}>
          {(a) => <Input {...a} maxLength={200} value={f.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label={t("f.phone")} error={checks.error("phone")}>
          {(a) => <Input {...a} type="tel" inputMode="tel" maxLength={20} value={f.phone} onChange={(e) => set("phone", e.target.value)} />}
        </Field>
        <Field label={t("f.altPhone")} error={checks.error("alt_phone")}>
          {(a) => <Input {...a} type="tel" inputMode="tel" maxLength={20} value={f.alt_phone} onChange={(e) => set("alt_phone", e.target.value)} />}
        </Field>
        <Field label={t("f.email")} error={checks.error("email")}>
          {(a) => <Input {...a} type="email" maxLength={200} value={f.email} onChange={(e) => set("email", e.target.value)} />}
        </Field>
        <Field label={t("f.treatment")}>{(a) => <LibraryCombobox {...a} kind="treatment_template" value={treatment} onChange={setTreatment} />}</Field>
        <Field label={t("f.treatmentText")} error={checks.error("treatment_text")}>
          {(a) => <Input {...a} maxLength={200} disabled={Boolean(treatment)} value={f.treatment_text} onChange={(e) => set("treatment_text", e.target.value)} />}
        </Field>
        <Field label={t("f.source")}>{(a) => <LibraryCombobox {...a} kind="lead_source" allowCreate value={source} onChange={setSource} />}</Field>
        <Field label={t("f.doctor")}>{(a) => <LibraryCombobox {...a} kind="doctor" value={doctor} onChange={setDoctor} />}</Field>
        <Field label={t("f.referredBy")} error={checks.error("referred_by_text")}>
          {(a) => <Input {...a} maxLength={200} value={f.referred_by_text} onChange={(e) => set("referred_by_text", e.target.value)} />}
        </Field>
        <Field label={t("f.mode")} error={checks.error("appointment_mode")}>
          {(a) => (
            <Select {...a} value={f.appointment_mode} onChange={(e) => set("appointment_mode", e.target.value)}>
              <option value="">{t("notSet")}</option>
              <option value="offline">{t("mode.offline")}</option>
              <option value="online">{t("mode.online")}</option>
            </Select>
          )}
        </Field>
        <Field label={t("f.surgeryDate")} hint={t("surgeryDateHint")} error={checks.error("surgery_date")}>
          {(a) => <Input {...a} type="date" value={f.surgery_date} onChange={(e) => set("surgery_date", e.target.value)} />}
        </Field>
        <Field label={t("f.amountQuoted")} error={checks.error("amount_quoted_paise")}>
          {(a) => <MoneyInput {...a} value={quoted} onChange={(v) => (setQuoted(v), checks.clear("amount_quoted_paise"))} />}
        </Field>
        <Field label={t("f.comments1")} error={checks.error("comments1")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={2000} value={f.comments1} onChange={(e) => set("comments1", e.target.value)} />}
        </Field>
        <Field label={t("f.comments2")} error={checks.error("comments2")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={2000} value={f.comments2} onChange={(e) => set("comments2", e.target.value)} />}
        </Field>
      </div>
    </DialogContent>
  );
}

/**
 * Amount finalised (the price agreed with the patient). Once a treatment has started it is locked
 * for sales; an admin (or reception) can still change it with a reason.
 */
export function AmountDialog({ lead, canOverride, onDone }: { lead: Lead; canOverride: boolean; onDone: (updated: Lead) => void }) {
  const t = useTranslations("leads");
  const errs = useTranslations("errors");
  const { saved, failed } = useFeedback();
  const [amount, setAmount] = useState<number | null>(lead.amount_finalised_paise);
  const [reason, setReason] = useState("");
  const needsReason = lead.amount_locked;
  const [schema] = useState(() => z.object({ amount: optionalPaise(), reason: needsReason ? requiredReason(300) : optionalText(300) }));
  const checks = useZodForm(schema);
  const save = useMutation({
    mutationFn: (d: { amount: number | null; reason: string | null }) =>
      rpc<Lead>("set_amount_finalised", { p_id: lead.id, p_amount_paise: d.amount, p_reason: d.reason }),
    onSuccess: (updated) => {
      saved(t("amountSaved"));
      onDone(updated);
    },
    onError: (e) => {
      if (asAppError(e).code === "reason_required") return checks.setError("reason", "errors.reason_required");
      failed(e);
    },
  });
  const blocked = lead.amount_locked && !canOverride;
  return (
    <DialogContent
      title={t("amountTitle", { name: lead.name })}
      description={blocked ? errs("amount_locked") : t("amountHint")}
      footer={
        <Button
          disabled={blocked || save.isPending}
          onClick={() => {
            const d = checks.validate({ amount, reason });
            if (d) save.mutate(d);
          }}
        >
          <IndianRupee aria-hidden />
          {t("saveAmount")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("f.amountFinalised")} hint={lead.amount_quoted_paise !== null ? t("quotedWas", { amount: formatINR(lead.amount_quoted_paise) }) : undefined} error={checks.error("amount")}>
          {(a) => <MoneyInput {...a} disabled={blocked} value={amount} onChange={(v) => (setAmount(v), checks.clear("amount"))} />}
        </Field>
        {needsReason && !blocked && (
          <Field label={t("amountReason")} hint={t("amountReasonHint")} error={checks.error("reason")}>
            {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
          </Field>
        )}
      </div>
    </DialogContent>
  );
}

/** A call made outside the phone app (desk phone): outcome, length, notes, next follow-up. */
export function LogCallDialog({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const t = useTranslations("leads");
  const { saved, failed } = useFeedback();
  const [f, setF] = useState({ direction: "outgoing", outcome: "connected", duration_min: "", notes: "", next_followup: "" });
  const [clientId] = useState(newId);
  const checks = useZodForm(logCallSchema);
  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    checks.clear(k);
  };
  const log = useMutation({
    mutationFn: (d: z.output<typeof logCallSchema>) =>
      rpc("log_call", {
        p_call: {
          client_id: clientId,
          lead_id: lead.id,
          phone: lead.phone_e164,
          direction: d.direction,
          outcome: d.outcome,
          started_at: new Date(Date.now() - d.duration_min * 60_000).toISOString(),
          duration_s: d.duration_min * 60,
          notes: d.notes,
          ...(d.next_followup ? { next_followup_at: fromIstDateTimeLocal(d.next_followup) } : {}),
        },
      }),
    onSuccess: () => {
      saved(t("callLogged"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("logCallTitle", { name: lead.name })}
      footer={
        <Button
          disabled={log.isPending}
          onClick={() => {
            const d = checks.validate(f);
            if (d) log.mutate(d);
          }}
        >
          <PhoneCall aria-hidden />
          {t("saveCall")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("f.direction")} error={checks.error("direction")}>
          {(a) => (
            <Select {...a} value={f.direction} onChange={(e) => set("direction", e.target.value)}>
              {CALL_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`direction.${d}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("f.outcome")} error={checks.error("outcome")}>
          {(a) => (
            <Select {...a} value={f.outcome} onChange={(e) => set("outcome", e.target.value)}>
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {t(`outcome.${o}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("f.minutes")} error={checks.error("duration_min")}>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={0} max={600} value={f.duration_min} onChange={(e) => set("duration_min", e.target.value)} />}
        </Field>
        <Field label={t("f.nextFollowup")} hint={t("nextFollowupHint")} error={checks.error("next_followup")}>
          {(a) => <Input {...a} type="datetime-local" value={f.next_followup} onChange={(e) => set("next_followup", e.target.value)} />}
        </Field>
        <Field label={t("f.callNotes")} error={checks.error("notes")} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={3} maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
      </div>
    </DialogContent>
  );
}

const deleteSchema = z.object({ reason: requiredReason(300) });

/** Remove a lead made by mistake (kept for the audit trail, hidden everywhere). */
export function DeleteLeadDialog({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const t = useTranslations("leads");
  const { saved, failed } = useFeedback();
  const [reason, setReason] = useState("");
  const checks = useZodForm(deleteSchema);
  const remove = useMutation({
    mutationFn: (r: string) => rpc("delete_lead", { p_id: lead.id, p_reason: r }),
    onSuccess: () => {
      saved(t("deleted"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("deleteTitle", { name: lead.name })}
      description={t("deleteHint")}
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
          {t("delete")}
        </Button>
      }
    >
      <Field label={t("deleteReason")} error={checks.error("reason")}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
      </Field>
    </DialogContent>
  );
}
