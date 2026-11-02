"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IndianRupee } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatINR } from "@pearl/shared";
import { MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { paymentSchema } from "@/lib/schemas/billing";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

/**
 * Payment against a bill, an advance, or a refund of the patient's advance.
 * An advance can be for one treatment (a part payment for a package): the treatment card counts it
 * as paid, and its final bill uses it.
 */
export function PaymentDialog({
  patientId,
  bill,
  forTreatment,
  onDone,
}: {
  patientId: string;
  /** Paying a bill: its id and what it still owes. */
  bill?: { id: string; bill_no: string | null; outstanding_paise: number };
  /** A part payment for this treatment's package. */
  forTreatment?: { id: string; name: string };
  onDone: () => void;
}) {
  const t = useTranslations("payment");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [kind, setKind] = useState<"payment" | "advance" | "refund">(bill ? "payment" : "advance");
  const [mode, setMode] = useState<LibraryItem | null>(null);
  const [amount, setAmount] = useState<number | null>(bill ? bill.outstanding_paise : null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [treatment, setTreatment] = useState(forTreatment?.id ?? "");
  // "For": the patient's open treatments (cached from the Care tab when it was open).
  const treatments = useQuery({
    queryKey: ["patient_treatments", patientId],
    queryFn: () => rpc<{ id: string; name: string; status: string }[]>("patient_treatments_list", { p_patient_id: patientId }),
    enabled: !bill && !forTreatment,
  });
  const openTreatments = (treatments.data ?? []).filter((x) => x.status === "active" || x.status === "on_hold");
  const [clientId] = useState(newId);
  const [schema] = useState(() => paymentSchema(bill ? bill.outstanding_paise : null));
  const checks = useZodForm(schema);
  const pay = useMutation({
    mutationFn: (d: { kind: string; mode: string; amount: number; reference: string | null; note: string | null; treatment: string }) =>
      rpc("add_payment", {
        p_payment: {
          patient_id: patientId,
          kind: d.kind,
          mode_id: d.mode,
          amount_paise: d.amount,
          reference: d.reference,
          note: d.note,
          ...(d.kind === "advance" && d.treatment ? { treatment_id: d.treatment } : {}),
          ...(bill && d.kind === "payment" ? { allocations: [{ bill_id: bill.id, amount_paise: d.amount }] } : {}),
        },
        p_client_id: clientId,
      }),
    onSuccess: (_, d) => {
      saved(t(`saved.${kind}`, { amount: formatINR(d.amount) }));
      for (const key of ["bill", "bills", "patient_balance", "patient_dues", "patient_timeline", "patient_treatments"]) void queryClient.invalidateQueries({ queryKey: [key] });
      onDone();
    },
    onError: (e) => {
      if (asAppError(e).code === "over_allocated") return checks.setError("amount", "errors.over_allocated");
      failed(e);
    },
  });
  return (
    <DialogContent
      title={bill ? t("titleBill", { no: bill.bill_no ?? "" }) : forTreatment ? t("titleTreatment", { name: forTreatment.name }) : t("title")}
      description={bill ? t("outstanding", { amount: formatINR(bill.outstanding_paise) }) : undefined}
      footer={
        <Button
          disabled={pay.isPending}
          onClick={() => {
            const d = checks.validate({ kind, mode, amount, reference, note, treatment });
            if (d) pay.mutate(d);
          }}
        >
          <IndianRupee aria-hidden />
          {t(`button.${kind}`)}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("kind")}>
          {(a) => (
            <Select {...a} value={kind} onChange={(e) => (setKind(e.target.value as typeof kind), checks.clear("amount"))}>
              {bill && <option value="payment">{t("kinds.payment")}</option>}
              <option value="advance">{t("kinds.advance")}</option>
              <option value="refund">{t("kinds.refund")}</option>
            </Select>
          )}
        </Field>
        {kind === "advance" && !bill && !forTreatment && openTreatments.length > 0 && (
          <Field label={t("for")} hint={t("forHint")} error={checks.error("treatment")}>
            {(a) => (
              <Select {...a} value={treatment} onChange={(e) => (setTreatment(e.target.value), checks.clear("treatment"))}>
                <option value="">{t("forGeneral")}</option>
                {openTreatments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {t("forTreatment", { name: x.name })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("mode")} error={checks.error("mode")}>
          {(a) => <LibraryCombobox {...a} kind="payment_mode" value={mode} onChange={(m) => (setMode(m), checks.clear("mode"))} />}
        </Field>
        <Field label={t("amount")} error={checks.error("amount")}>
          {(a) => <MoneyInput {...a} value={amount} onChange={(v) => (setAmount(v), checks.clear("amount"))} />}
        </Field>
        <Field label={t("reference")} hint={t("referenceHint")} error={checks.error("reference")}>
          {(a) => <Input {...a} maxLength={80} value={reference} onChange={(e) => (setReference(e.target.value), checks.clear("reference"))} />}
        </Field>
        <Field label={t("note")} error={checks.error("note")}>
          {(a) => <Input {...a} maxLength={300} value={note} onChange={(e) => (setNote(e.target.value), checks.clear("note"))} />}
        </Field>
      </div>
    </DialogContent>
  );
}
