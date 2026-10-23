"use client";

import { useMutation } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { LEAD_STAGES, type Lead, type LeadStage } from "./types";

/** Change a lead's stage. Lost needs a reason (and may carry a note). */
export function StageDialog({ lead, initial, onDone }: { lead: Pick<Lead, "id" | "name" | "stage">; initial?: LeadStage; onDone: (updated: Lead) => void }) {
  const t = useTranslations("leads");
  const { saved, failed } = useFeedback();
  const [stage, setStage] = useState<LeadStage>(initial ?? lead.stage);
  const [reason, setReason] = useState<LibraryItem | null>(null);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () =>
      rpc<Lead>("set_lead_stage", {
        p_id: lead.id,
        p_stage: stage,
        p_lost_reason_id: stage === "lost" ? reason?.id : null,
        p_note: note.trim() || null,
      }),
    onSuccess: (updated) => {
      saved(t("stageSaved", { stage: t(`stage.${stage}`) }));
      onDone(updated);
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("stageTitle", { name: lead.name })}
      footer={
        <Button disabled={save.isPending || (stage === "lost" && !reason)} onClick={() => save.mutate()}>
          <Flag aria-hidden />
          {t("saveStage")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("f.stage")}>
          {(a) => (
            <Select {...a} value={stage} onChange={(e) => setStage(e.target.value as LeadStage)}>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`stage.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {stage === "lost" && (
          <Field label={t("f.lostReason")}>{(a) => <LibraryCombobox id={a.id} kind="lost_reason" allowCreate value={reason} onChange={setReason} />}</Field>
        )}
        <Field label={t("f.note")}>{(a) => <Textarea {...a} rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </DialogContent>
  );
}
