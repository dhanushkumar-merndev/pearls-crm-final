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
import { useFeedback } from "@/lib/use-feedback";

/** New follow-up / task for a patient: due date + what to do. */
export function FollowupDialog({ patient: initial = null, onDone }: { patient?: PatientHit | null; onDone: () => void }) {
  const t = useTranslations("followups");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [patient, setPatient] = useState<PatientHit | null>(initial);
  const [due, setDue] = useState(() => istDateString(new Date(Date.now() + 7 * 86_400_000)));
  const [reason, setReason] = useState("");
  const [clientId] = useState(newId);
  const create = useMutation({
    mutationFn: () => rpc("create_followup", { p_followup: { patient_id: patient!.id, due_date: due, reason }, p_client_id: clientId }),
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
        <Button disabled={!patient || !reason.trim() || create.isPending} onClick={() => create.mutate()}>
          <CalendarCheck aria-hidden />
          {t("add")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {!initial && <Field label={t("patient")}>{(a) => <PatientPicker id={a.id} value={patient} onChange={setPatient} />}</Field>}
        <Field label={t("due")}>{(a) => <Input {...a} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        <Field label={t("reason")} hint={t("reasonHint")}>
          {(a) => <Textarea {...a} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </DialogContent>
  );
}
