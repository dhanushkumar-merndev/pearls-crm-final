"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { istDateString } from "@pearl/shared";
import { PatientPicker, type PatientHit } from "@/components/patients/patient-picker";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { newId, rpc } from "@/lib/rpc";
import { followupSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

/** New follow-up / task for a patient: due date + what to do. */
export function FollowupDialog({ patient: initial = null, onDone }: { patient?: PatientHit | null; onDone: () => void }) {
  const t = useTranslations("followups");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [patient, setPatient] = useState<PatientHit | null>(initial);
  const [due, setDue] = useState(() => istDateString(new Date(Date.now() + 7 * 86_400_000)));
  const [reason, setReason] = useState("");
  const [clientId] = useState(newId);
  const checks = useZodForm(followupSchema);
  const create = useMutation({
    mutationFn: (d: { patient: string; due: string; reason: string }) =>
      rpc("create_followup", { p_followup: { patient_id: d.patient, due_date: d.due, reason: d.reason }, p_client_id: clientId }),
    onSuccess: () => {
      saved(t("added"));
      void queryClient.invalidateQueries({ queryKey: ["followups"] });
      void queryClient.invalidateQueries({ queryKey: ["today_board"] });
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("addTitle")}
      footer={
        <Button
          disabled={create.isPending}
          onClick={() => {
            const d = checks.validate({ patient, due, reason });
            if (d) create.mutate(d);
          }}
        >
          <CalendarCheck aria-hidden />
          {t("add")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {!initial && (
          <Field label={t("patient")} error={checks.error("patient")}>
            {(a) => <PatientPicker {...a} value={patient} onChange={(p) => (setPatient(p), checks.clear("patient"))} />}
          </Field>
        )}
        <Field label={t("due")} error={checks.error("due")}>
          {(a) => <Input {...a} type="date" value={due} onChange={(e) => (setDue(e.target.value), checks.clear("due"))} />}
        </Field>
        <Field label={t("reason")} hint={t("reasonHint")} error={checks.error("reason")}>
          {(a) => <Textarea {...a} rows={2} maxLength={500} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
        </Field>
      </div>
    </DialogContent>
  );
}
