"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleX, IndianRupee, Pencil, Printer, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDateTime, formatINR } from "@pearl/shared";
import { BillEditor } from "@/components/bills/bill-editor";
import { FinalizeDialog } from "@/components/bills/finalize-dialog";
import { PaymentDialog } from "@/components/bills/payment-dialog";
import { payable, type Bill } from "@/components/bills/types";
import { MoneyInput } from "@/components/forms/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Field, Textarea } from "@/components/ui/form";
import { MoreMenu } from "@/components/ui/more-menu";
import { DetailHeader, Page } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useMe } from "@/lib/use-me";
import { applyAdvanceSchema } from "@/lib/schemas/billing";
import { reasonSchema } from "@/lib/schemas/clinical";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface PrintData extends Bill {
  payments: { received_at: string; mode: string; reference: string | null; amount_paise: number }[];
}

export function BillScreen({ initial }: { initial: Bill }) {
  const t = useTranslations("bill");
  const me = useMe();
  const router = useRouter();
  const bill = useQuery({ queryKey: ["bill", initial.id], initialData: initial, queryFn: () => rpc<Bill>("get_bill", { p_bill_id: initial.id }) });
  const b = bill.data;
  const [amending, setAmending] = useState(false);
  const [dialog, setDialog] = useState<"pay" | "advance" | "cancel" | null>(null);
  const [finalizing, setFinalizing] = useState<Bill | null>(null);
  const due = payable(b) - b.received_paise;

  const canPay = b.status === "finalized" && due > 0;
  const isAdmin = me?.role === "admin" && b.status === "finalized";
  // A plain link: a prefetch would count as a print and make the next one a "Duplicate copy".
  const printLink = (primary: boolean) => (
    <Button asChild variant={primary ? "primary" : "secondary"}>
      <a href={`/print/bill/${b.id}`} target="_blank" rel="noopener">
        <Printer aria-hidden />
        {t("print")}
      </a>
    </Button>
  );

  return (
    <Page>
      <DetailHeader
        back={{ href: `/patients/${b.patient_id}`, label: t("backTo", { name: b.patient }) }}
        title={
          <>
            {t(`type.${b.bill_type}`)} {b.bill_no && <span className="tabular-nums">· {b.bill_no}</span>}
          </>
        }
        badges={<StatusBadge kind={b.status === "finalized" ? "good" : b.status === "draft" ? "warning" : "critical"} label={t(`status.${b.status}`)} />}
        meta={
          <>
            {b.patient} · {b.uhid}
            {b.bill_at && ` · ${formatDateTime(new Date(b.bill_at))}`}
          </>
        }
      />

      {b.status === "draft" ? (
        <BillEditor key={b.version} bill={b} onFinalize={setFinalizing} />
      ) : amending ? (
        <BillEditor bill={b} amend onAmended={() => (setAmending(false), void bill.refetch())} />
      ) : (
        <>
          {/* Money still due: taking it is the main job; printing comes after. */}
          <div className="flex flex-wrap gap-2">
            {canPay && (
              <Button onClick={() => setDialog("pay")}>
                <IndianRupee aria-hidden />
                {t("addPayment")}
              </Button>
            )}
            {printLink(!canPay)}
            {canPay && (b.patient_credit_paise ?? 0) > 0 && (
              <Button variant="secondary" onClick={() => setDialog("advance")}>
                <Wallet aria-hidden />
                {t("useAdvanceButton", { amount: formatINR(b.patient_credit_paise ?? 0) })}
              </Button>
            )}
            {isAdmin && (
              <MoreMenu>
                <DropdownMenuItem onSelect={() => setAmending(true)}>
                  <Pencil aria-hidden />
                  {t("amend")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("cancel")}>
                  <CircleX aria-hidden />
                  {t("cancelBill")}
                </DropdownMenuItem>
              </MoreMenu>
            )}
          </div>
          {b.status === "cancelled" && <Card role="status">{t("cancelledBecause", { reason: b.cancel_reason ?? "" })}</Card>}
          <BillView bill={b} />
        </>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog === "pay" && (
          <PaymentDialog patientId={b.patient_id} bill={{ id: b.id, bill_no: b.bill_no, outstanding_paise: due }} onDone={() => (setDialog(null), void bill.refetch())} />
        )}
        {dialog === "advance" && <AdvanceDialog bill={b} due={due} onDone={() => (setDialog(null), void bill.refetch())} />}
        {dialog === "cancel" && <CancelDialog bill={b} onDone={() => (setDialog(null), router.refresh(), void bill.refetch())} />}
      </Dialog>
      <Dialog open={finalizing !== null} onOpenChange={(o) => !o && setFinalizing(null)}>
        {finalizing && <FinalizeDialog bill={finalizing} onDone={() => (setFinalizing(null), router.refresh(), void bill.refetch())} />}
      </Dialog>
    </Page>
  );
}

function BillView({ bill: b }: { bill: Bill }) {
  const t = useTranslations("bill");
  const print = useQuery({
    queryKey: ["bill_view", b.id, b.version, b.received_paise],
    queryFn: () => rpc<PrintData>("bill_print_data", { p_bill_id: b.id, p_count: false }),
  });
  return (
    <div className="flex flex-col gap-4">
      <Table>
        <THead>
          <tr>
            <TH>#</TH>
            <TH>{t("description")}</TH>
            <TH className="text-right">{t("rate")}</TH>
            <TH className="text-right">{t("qty")}</TH>
            <TH className="text-right">{t("discount")}</TH>
            <TH className="text-right">{t("gst")}</TH>
            <TH className="text-right">{t("amount")}</TH>
          </tr>
        </THead>
        <tbody>
          {b.items.map((i) => (
            <TR key={i.id}>
              <TD className="tabular-nums">{i.line_no}</TD>
              <TD>
                {i.description}
                {i.category && <span className="block text-[0.9rem] text-text-secondary">{i.category}</span>}
                {i.carried_from_bill_no && <span className="block text-[0.9rem] text-text-secondary">{t("carriedFromBill", { no: i.carried_from_bill_no })}</span>}
              </TD>
              <TD className="text-right tabular-nums">{formatINR(i.rate_paise)}</TD>
              <TD className="text-right tabular-nums">{Number(i.qty)}</TD>
              <TD className="text-right tabular-nums">
                {i.discount_paise > 0 ? (i.discount_type === "percent" ? `${i.discount_value / 100} %` : formatINR(i.discount_paise)) : "—"}
              </TD>
              <TD className="text-right tabular-nums">{i.gst_rate_bp / 100}%</TD>
              <TD className="text-right font-medium tabular-nums">{formatINR(i.total_paise)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <CardTitle>{t("payments")}</CardTitle>
          {print.data?.payments.length === 0 && <p className="text-text-secondary">{t("noPayments")}</p>}
          <ul className="flex flex-col gap-1">
            {print.data?.payments.map((p, i) => (
              <li key={i} className="flex justify-between gap-3 tabular-nums">
                <span>
                  {formatDateTime(new Date(p.received_at))} · {p.mode}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span>{formatINR(p.amount_paise)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="grid grid-cols-2 gap-y-1 tabular-nums">
          <span className="text-text-secondary">{t("gross")}</span>
          <span className="text-right">{formatINR(b.gross_paise)}</span>
          <span className="text-text-secondary">{t("discountTotal")}</span>
          <span className="text-right">−{formatINR(b.discount_paise)}</span>
          <span className="text-text-secondary">{t("cgst")}</span>
          <span className="text-right">{formatINR(b.cgst_paise)}</span>
          <span className="text-text-secondary">{t("sgst")}</span>
          <span className="text-right">{formatINR(b.sgst_paise)}</span>
          {b.round_off_paise !== 0 && (
            <>
              <span className="text-text-secondary">{t("roundOff")}</span>
              <span className="text-right">{formatINR(b.round_off_paise)}</span>
            </>
          )}
          {b.carried_in_paise > 0 && (
            <>
              <span className="text-text-secondary">{t("carriedInTotal")}</span>
              <span className="text-right">{formatINR(b.carried_in_paise)}</span>
            </>
          )}
          <span className="border-t border-border pt-1 text-lg font-semibold">{t("total")}</span>
          <span className="border-t border-border pt-1 text-right text-lg font-semibold">{formatINR(payable(b))}</span>
          <span className="text-text-secondary">{t("received")}</span>
          <span className="text-right">{formatINR(b.received_paise)}</span>
          <span className="font-semibold">{t("balance")}</span>
          <span className="text-right font-semibold">{formatINR(payable(b) - b.received_paise)}</span>
        </Card>
      </div>
    </div>
  );
}

function AdvanceDialog({ bill, due, onDone }: { bill: Bill; due: number; onDone: () => void }) {
  const t = useTranslations("bill");
  const { saved, failed } = useFeedback();
  const [amount, setAmount] = useState<number | null>(Math.min(due, bill.patient_credit_paise ?? 0));
  const [schema] = useState(() => applyAdvanceSchema(Math.min(due, bill.patient_credit_paise ?? 0)));
  const checks = useZodForm(schema);
  const apply = useMutation({
    mutationFn: (paise: number) => rpc("apply_advance", { p_bill_id: bill.id, p_amount_paise: paise }),
    onSuccess: () => {
      saved(t("advanceUsed"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("useAdvance")}
      description={t("advanceAvailable", { amount: formatINR(bill.patient_credit_paise ?? 0) })}
      footer={
        <Button
          disabled={apply.isPending}
          onClick={() => {
            const d = checks.validate({ amount });
            if (d) apply.mutate(d.amount);
          }}
        >
          <Wallet aria-hidden />
          {t("useAdvance")}
        </Button>
      }
    >
      <Field label={t("amount")} error={checks.error("amount")}>
        {(a) => <MoneyInput {...a} value={amount} onChange={(v) => (setAmount(v), checks.clear("amount"))} />}
      </Field>
    </DialogContent>
  );
}

function CancelDialog({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const t = useTranslations("bill");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [reason, setReason] = useState("");
  const checks = useZodForm(reasonSchema);
  const cancel = useMutation({
    mutationFn: (r: string) => rpc("cancel_bill", { p_bill_id: bill.id, p_reason: r }),
    onSuccess: () => {
      saved(t("cancelled"));
      void queryClient.invalidateQueries({ queryKey: ["bills"] });
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("cancelTitle", { no: bill.bill_no ?? "" })}
      description={t("cancelHint")}
      footer={
        <Button
          variant="danger"
          disabled={cancel.isPending}
          onClick={() => {
            const d = checks.validate({ reason });
            if (d) cancel.mutate(d.reason);
          }}
        >
          <CircleX aria-hidden />
          {t("cancelBill")}
        </Button>
      }
    >
      <Field label={t("reason")} error={checks.error("reason")}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={reason} onChange={(e) => (setReason(e.target.value), checks.clear("reason"))} />}
      </Field>
    </DialogContent>
  );
}
