"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, CirclePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { formatINR } from "@pearl/shared";
import { MoneyInput } from "@/components/forms/money-input";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { asAppError, newId, rpc } from "@/lib/rpc";
import { finalizeSchema } from "@/lib/schemas/billing";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
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
  const schema = useMemo(() => finalizeSchema({ due, credit, needsReason }), [due, credit, needsReason]);
  const checks = useZodForm(schema);
  const setRow = (i: number, key: string, patch: Partial<PayRow>) => {
    setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    for (const f of Object.keys(patch)) checks.clear(`rows.${i}.${f}`);
  };
  const finalize = useMutation({
    mutationFn: (d: z.output<typeof schema>) =>
      rpc<Bill>("finalize_bill", {
        p_bill_id: bill.id,
        p_version: bill.version,
        p_payments: d.rows
          .filter((r) => (r.amount ?? 0) > 0)
          .map((r) => ({ client_id: r.key, mode_id: r.mode, amount_paise: r.amount, reference: r.reference })),
        p_use_advance_paise: d.use_advance ?? 0,
        p_below_agreed_reason: d.reason,
      }),
    onSuccess: (b) => {
      saved(t("finalized", { no: b.bill_no ?? "" }));
      void queryClient.invalidateQueries({ queryKey: ["bills"] });
      void queryClient.invalidateQueries({ queryKey: ["patient_balance", bill.patient_id] });
      onDone();
    },
    onError: (e) => {
      if (asAppError(e).code === "below_agreed_price") {
        setNeedsReason(true);
        return checks.setError("reason", "errors.below_agreed_price");
      }
      failed(e);
    },
  });
  return (
    <DialogContent
      wide
      title={t("finalizeTitle")}
      description={t("finalizeHint", { total: formatINR(total) }) + (bill.received_paise > 0 ? ` ${t("alreadyReceived", { amount: formatINR(bill.received_paise), due: formatINR(due) })}` : "")}
      footer={
        <Button
          disabled={finalize.isPending}
          onClick={() => {
            const d = checks.validate({ use_advance: useAdvance, rows, reason });
            if (d) finalize.mutate(d);
          }}
        >
          <CheckCheck aria-hidden />
          {paid >= due ? t("finalizePaid") : paid > 0 ? t("finalizePart", { left: formatINR(due - paid) }) : t("finalizeUnpaid")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {credit > 0 && (
          <Field label={t("useAdvance")} hint={t("advanceAvailable", { amount: formatINR(credit) })} error={checks.error("use_advance")}>
            {(a) => <MoneyInput {...a} value={useAdvance} onChange={(v) => (setUseAdvance(v), checks.clear("use_advance"))} />}
          </Field>
        )}
        <p className="font-medium">{t("paymentsNow")}</p>
        {rows.map((r, i) => (
          <div key={r.key} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start">
            <Field label={t("mode")} error={checks.error(`rows.${i}.mode`)}>
              {(a) => <LibraryCombobox {...a} kind="payment_mode" value={r.mode} onChange={(m) => setRow(i, r.key, { mode: m })} />}
            </Field>
            <Field label={t("amount")} error={checks.error(`rows.${i}.amount`)}>
              {(a) => <MoneyInput {...a} value={r.amount} onChange={(v) => setRow(i, r.key, { amount: v })} />}
            </Field>
            <Field label={t("reference")} hint={t("referenceHint")} error={checks.error(`rows.${i}.reference`)}>
              {(a) => <Input {...a} maxLength={80} value={r.reference} onChange={(e) => setRow(i, r.key, { reference: e.target.value })} />}
            </Field>
            <Button variant="ghost" className="sm:mt-7" aria-label={t("removePayment")} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button variant="ghost" className="self-start" onClick={() => setRows((rs) => [...rs, { key: newId(), mode: null, amount: null, reference: "" }])}>
          <CirclePlus aria-hidden />
          {t("splitPayment")}
        </Button>
        {paid > due && !checks.hasErrors && <p className="text-bad-text">{t("overpaid")}</p>}
        {(needsReason || (bill.bill_type === "final_bill" && bill.agreed_price_paise !== null)) && (
          <Field label={t("belowAgreedReason")} hint={t("belowAgreedHint", { agreed: formatINR(bill.agreed_price_paise ?? 0) })} error={checks.error("reason")}>
            {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
          </Field>
        )}
      </div>
    </DialogContent>
  );
}
