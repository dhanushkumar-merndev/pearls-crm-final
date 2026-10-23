"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, CirclePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatINR } from "@pearl/shared";
import { MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { payable, type Bill } from "./types";

interface PayRow {
  key: string;
  mode: LibraryItem | null;
  amount: number | null;
  reference: string;
}

/** Finalize: the number is taken now. Optional payments (any mix of modes) and advance use. */
export function FinalizeDialog({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const t = useTranslations("bill");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const total = payable(bill);
  // A final bill: what the carried-in bills already received counts (one episode, one balance).
  const due = Math.max(total - bill.received_paise, 0);
  const credit = Math.max(bill.patient_credit_paise ?? 0, 0);
  const [useAdvance, setUseAdvance] = useState<number | null>(Math.min(credit, due) || null);
  const [rows, setRows] = useState<PayRow[]>([{ key: newId(), mode: null, amount: Math.max(due - Math.min(credit, due), 0) || null, reference: "" }]);
  const [reason, setReason] = useState("");
  const [needsReason, setNeedsReason] = useState(false);
  const paid = rows.reduce((s, r) => s + (r.amount ?? 0), 0) + (useAdvance ?? 0);
  const valid = rows.every((r) => (r.amount ?? 0) === 0 || r.mode) && paid <= due && (useAdvance ?? 0) <= credit;
  const finalize = useMutation({
    mutationFn: () =>
      rpc<Bill>("finalize_bill", {
        p_bill_id: bill.id,
        p_version: bill.version,
        p_payments: rows
          .filter((r) => (r.amount ?? 0) > 0)
          .map((r) => ({ client_id: r.key, mode_id: r.mode!.id, amount_paise: r.amount, reference: r.reference })),
        p_use_advance_paise: useAdvance ?? 0,
        p_below_agreed_reason: reason || null,
      }),
    onSuccess: (b) => {
      saved(t("finalized", { no: b.bill_no ?? "" }));
      void queryClient.invalidateQueries({ queryKey: ["bills"] });
      void queryClient.invalidateQueries({ queryKey: ["patient_balance", bill.patient_id] });
      onDone();
    },
    onError: (e) => {
      if (asAppError(e).code === "below_agreed_price") setNeedsReason(true);
      failed(e);
    },
  });
  return (
    <DialogContent
      wide
      title={t("finalizeTitle")}
      description={t("finalizeHint", { total: formatINR(total) }) + (bill.received_paise > 0 ? ` ${t("alreadyReceived", { amount: formatINR(bill.received_paise), due: formatINR(due) })}` : "")}
      footer={
        <Button disabled={!valid || finalize.isPending || (needsReason && reason.trim().length < 3)} onClick={() => finalize.mutate()}>
          <CheckCheck aria-hidden />
          {paid >= due ? t("finalizePaid") : paid > 0 ? t("finalizePart", { left: formatINR(due - paid) }) : t("finalizeUnpaid")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {credit > 0 && (
          <Field label={t("useAdvance")} hint={t("advanceAvailable", { amount: formatINR(credit) })}>
            {(a) => <MoneyInput {...a} value={useAdvance} onChange={setUseAdvance} />}
          </Field>
        )}
        <p className="font-medium">{t("paymentsNow")}</p>
        {rows.map((r) => (
          <div key={r.key} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Field label={t("mode")}>
              {(a) => <LibraryCombobox id={a.id} kind="payment_mode" value={r.mode} onChange={(m) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, mode: m } : x)))} />}
            </Field>
            <Field label={t("amount")}>
              {(a) => <MoneyInput {...a} value={r.amount} onChange={(v) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, amount: v } : x)))} />}
            </Field>
            <Field label={t("reference")} hint={t("referenceHint")}>
              {(a) => <Input {...a} maxLength={80} value={r.reference} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, reference: e.target.value } : x)))} />}
            </Field>
            <Button variant="ghost" aria-label={t("removePayment")} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button variant="ghost" className="self-start" onClick={() => setRows((rs) => [...rs, { key: newId(), mode: null, amount: null, reference: "" }])}>
          <CirclePlus aria-hidden />
          {t("splitPayment")}
        </Button>
        {paid > due && <p className="text-bad-text">{t("overpaid")}</p>}
        {(needsReason || (bill.bill_type === "final_bill" && bill.agreed_price_paise !== null)) && (
          <Field label={t("belowAgreedReason")} hint={t("belowAgreedHint", { agreed: formatINR(bill.agreed_price_paise ?? 0) })}>
            {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        )}
      </div>
    </DialogContent>
  );
}
