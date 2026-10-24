"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
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

/** Payment against a bill, an advance, or a refund of the patient's advance. */
export function PaymentDialog({
  patientId,
  bill,
  onDone,
}: {
  patientId: string;
  /** Paying a bill: its id and what it still owes. */
  bill?: { id: string; bill_no: string | null; outstanding_paise: number };
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
  const [clientId] = useState(newId);
  const [schema] = useState(() => paymentSchema(bill ? bill.outstanding_paise : null));
  const checks = useZodForm(schema);
  const pay = useMutation({
    mutationFn: (d: { kind: string; mode: string; amount: number; reference: string | null; note: string | null }) =>
      rpc("add_payment", {
        p_payment: {
          patient_id: patientId,
          kind: d.kind,
          mode_id: d.mode,
          amount_paise: d.amount,
          reference: d.reference,
          note: d.note,
          ...(bill && d.kind === "payment" ? { allocations: [{ bill_id: bill.id, amount_paise: d.amount }] } : {}),
        },
        p_client_id: clientId,
      }),
    onSuccess: (_, d) => {
      saved(t(`saved.${kind}`, { amount: formatINR(d.amount) }));
      for (const key of ["bill", "bills", "patient_balance", "patient_timeline"]) void queryClient.invalidateQueries({ queryKey: [key] });
      onDone();
    },
    onError: (e) => {
      if (asAppError(e).code === "over_allocated") return checks.setError("amount", "errors.over_allocated");
      failed(e);
    },
  });
  return (
    <DialogContent
      title={bill ? t("titleBill", { no: bill.bill_no ?? "" }) : t("title")}
      description={bill ? t("outstanding", { amount: formatINR(bill.outstanding_paise) }) : undefined}
      footer={
        <Button
          disabled={pay.isPending}
          onClick={() => {
            const d = checks.validate({ kind, mode, amount, reference, note });
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
