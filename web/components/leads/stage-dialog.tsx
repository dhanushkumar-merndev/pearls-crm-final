"use client";

import { useMutation } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { leadStageSchema } from "@pearl/shared";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { asAppError, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { LEAD_STAGES, type Lead, type LeadStage } from "./types";

/** Change a lead's stage. Lost needs a reason (and may carry a note). */
export function StageDialog({ lead, initial, onDone }: { lead: Pick<Lead, "id" | "name" | "stage">; initial?: LeadStage; onDone: (updated: Lead) => void }) {
  const t = useTranslations("leads");
  const { saved, failed } = useFeedback();
  const [stage, setStage] = useState<LeadStage>(initial ?? lead.stage);
  const [reason, setReason] = useState<LibraryItem | null>(null);
  const [note, setNote] = useState("");
  const checks = useZodForm(leadStageSchema);
  const save = useMutation({
    mutationFn: (d: { stage: LeadStage; reason: string | null; note: string | null }) =>
      rpc<Lead>("set_lead_stage", {
        p_id: lead.id,
        p_stage: d.stage,
        p_lost_reason_id: d.stage === "lost" ? d.reason : null,
        p_note: d.note,
      }),
    onSuccess: (updated) => {
      saved(t("stageSaved", { stage: t(`stage.${stage}`) }));
      onDone(updated);
    },
    onError: (e) => {
      if (asAppError(e).code === "reason_required") return checks.setError("reason", "leads.needLostReason");
      failed(e);
    },
  });
  return (
    <DialogContent
      title={t("stageTitle", { name: lead.name })}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ stage, reason, note });
            if (d) save.mutate(d);
          }}
        >
          <Flag aria-hidden />
          {t("saveStage")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("f.stage")} error={checks.error("stage")}>
          {(a) => (
            <Select {...a} value={stage} onChange={(e) => (setStage(e.target.value as LeadStage), checks.clear("reason"))}>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`stage.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {stage === "lost" && (
          <Field label={t("f.lostReason")} error={checks.error("reason")}>
            {(a) => <LibraryCombobox {...a} kind="lost_reason" allowCreate value={reason} onChange={(v) => (setReason(v), checks.clear("reason"))} />}
          </Field>
        )}
        <Field label={t("f.note")} error={checks.error("note")}>
          {(a) => <Textarea {...a} rows={2} maxLength={4000} value={note} onChange={(e) => (setNote(e.target.value), checks.clear("note"))} />}
        </Field>
      </div>
    </DialogContent>
  );
}
