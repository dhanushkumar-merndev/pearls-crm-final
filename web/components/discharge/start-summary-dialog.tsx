"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";

interface Autofill {
  admission?: { surgeons?: { doctor_id: string; role: string }[] };
  op?: { doctor_id: string | null };
  template: { id: string; name: string; sections: unknown[]; medications: unknown[]; follow_up_days: number | null } | null;
  pharmacy_medicines: Record<string, unknown>[];
}

/** What the summary is for: an IP stay, or an OP visit / treatment session. */
export type SummaryTarget = { admissionId: string } | { visitId: string | null; sessionId: string | null };

/**
 * Start a discharge summary from a template (the treatment's, or chosen), plus the medicines of its
 * pharmacy bills: for an IP stay, or for an OP visit / session (owner, 17/11/2026: "OP also"). Used on
 * the stay page, the bill page and the Bills tab's Discharge section.
 */
export function StartSummaryDialog(target: SummaryTarget) {
  const ip = "admissionId" in target;
  const admissionId = ip ? target.admissionId : null;
  const visitId = ip ? null : target.visitId;
  const sessionId = ip ? null : target.sessionId;
  const autofill = (templateId?: string) =>
    ip
      ? rpc<Autofill>("discharge_autofill", { p_admission_id: admissionId, ...(templateId ? { p_template_id: templateId } : {}) })
      : rpc<Autofill>("discharge_autofill_op", { p_visit_id: visitId, p_session_id: sessionId, ...(templateId ? { p_template_id: templateId } : {}) });
  const t = useTranslations("ip");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { failed } = useFeedback();
  const templates = useQuery({
    queryKey: ["discharge_templates"],
    queryFn: () => rpc<{ id: string; name: string; active: boolean }[]>("discharge_templates_list"),
  });
  const auto = useQuery({
    queryKey: ["discharge_autofill", admissionId, visitId, sessionId],
    queryFn: () => autofill(),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const templateId = chosen ?? auto.data?.template?.id ?? "";
  const [summaryId] = useState(newId);
  const start = useMutation({
    mutationFn: async () => {
      const source = templateId ? await autofill(templateId) : auto.data!;
      const tpl = source.template;
      const surgeons = auto.data?.admission?.surgeons ?? [];
      const content = {
        sections: tpl?.sections ?? [{ key: newId(), title: t("defaultSection"), body: "" }],
        medications: [...(tpl?.medications ?? []), ...source.pharmacy_medicines],
        follow_up_days: tpl?.follow_up_days ?? null,
        follow_up_note: "",
        doctor_id: ip ? (surgeons.find((s) => s.role === "primary")?.doctor_id ?? surgeons[0]?.doctor_id ?? null) : (auto.data?.op?.doctor_id ?? null),
      };
      return rpc<{ id: string }>("save_discharge_summary", {
        p_id: summaryId,
        p_admission_id: admissionId,
        p_content: content,
        p_version: null,
        p_template_id: tpl?.id ?? null,
        ...(ip ? {} : { p_visit_id: visitId, p_session_id: sessionId }),
      });
    },
    onSuccess: (s) => {
      if (admissionId) void queryClient.invalidateQueries({ queryKey: ["admission", admissionId] });
      void queryClient.invalidateQueries({ queryKey: ["bill_paperwork"] });
      void queryClient.invalidateQueries({ queryKey: ["discharge_summaries"] });
      router.push(`/discharge/${s.id}`);
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("writeSummary")}
      description={t("summaryStartHint")}
      footer={
        <Button disabled={auto.isPending || start.isPending} onClick={() => start.mutate()}>
          <FileText aria-hidden />
          {t("startSummary")}
        </Button>
      }
    >
      <Field label={t("template")}>
        {(a) => (
          <Select {...a} value={templateId} onChange={(e) => setChosen(e.target.value)}>
            <option value="">{t("blankSummary")}</option>
            {templates.data
              ?.filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
        )}
      </Field>
      {(auto.data?.pharmacy_medicines.length ?? 0) > 0 && <p className="mt-3 text-text-secondary">{t("medsFromBills", { n: auto.data!.pharmacy_medicines.length })}</p>}
    </DialogContent>
  );
}
