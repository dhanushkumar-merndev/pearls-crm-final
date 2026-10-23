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
import { newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";

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
  const pay = useMutation({
    mutationFn: () =>
      rpc("add_payment", {
        p_payment: {
          patient_id: patientId,
          kind,
          mode_id: mode!.id,
          amount_paise: amount,
          reference,
          note,
          ...(bill && kind === "payment" ? { allocations: [{ bill_id: bill.id, amount_paise: amount }] } : {}),
        },
        p_client_id: clientId,
      }),
    onSuccess: () => {
      saved(t(`saved.${kind}`, { amount: formatINR(amount ?? 0) }));
      for (const key of ["bill", "bills", "patient_balance", "patient_timeline"]) void queryClient.invalidateQueries({ queryKey: [key] });
      onDone();
    },
    onError: failed,
  });
  const tooMuch = bill && kind === "payment" && (amount ?? 0) > bill.outstanding_paise;
  return (
    <DialogContent
      title={bill ? t("titleBill", { no: bill.bill_no ?? "" }) : t("title")}
      description={bill ? t("outstanding", { amount: formatINR(bill.outstanding_paise) }) : undefined}
      footer={
        <Button disabled={!mode || !amount || amount <= 0 || Boolean(tooMuch) || pay.isPending} onClick={() => pay.mutate()}>
          <IndianRupee aria-hidden />
          {t(`button.${kind}`)}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("kind")}>
          {(a) => (
            <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {bill && <option value="payment">{t("kinds.payment")}</option>}
              <option value="advance">{t("kinds.advance")}</option>
              <option value="refund">{t("kinds.refund")}</option>
            </Select>
          )}
        </Field>
        <Field label={t("mode")}>{(a) => <LibraryCombobox id={a.id} kind="payment_mode" value={mode} onChange={setMode} />}</Field>
        <Field label={t("amount")} error={tooMuch ? t("tooMuch") : undefined}>
          {(a) => <MoneyInput {...a} value={amount} onChange={setAmount} />}
        </Field>
        <Field label={t("reference")} hint={t("referenceHint")}>
          {(a) => <Input {...a} maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
        <Field label={t("note")}>{(a) => <Input {...a} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </DialogContent>
  );
}
