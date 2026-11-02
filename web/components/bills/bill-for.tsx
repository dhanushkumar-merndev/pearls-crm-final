"use client";

import { Receipt } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatINR } from "@pearl/shared";
import { billForLabel, type BillChipData, type BillFor } from "@/lib/bill-for";

export type { BillChipData, BillFor };

export function useBillForLabel() {
  const t = useTranslations("billFor");
  return (f: BillFor | null | undefined) => billForLabel(f, t);
}

/** "PR-104 · ₹5,000.00 · Paid" → opens the bill. */
export function BillChip({ bill, back }: { bill: BillChipData; back?: string }) {
  const t = useTranslations("billFor");
  const b = useTranslations("bill");
  const due = bill.total_paise - bill.received_paise;
  const state =
    bill.status === "draft" ? (
      <span className="text-text-secondary">{t("draft")}</span>
    ) : due > 0 ? (
      <span className="text-bad-text">{t("due", { amount: formatINR(due) })}</span>
    ) : (
      <span className="text-good-text">{t("paid")}</span>
    );
  return (
    <Link
      href={back ? `/bills/${bill.id}?back=${encodeURIComponent(back)}` : `/bills/${bill.id}`}
      aria-label={t("open", { no: bill.bill_no ?? t("draft"), type: b(`type.${bill.bill_type}`) })}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[0.9rem] hover:bg-accent"
    >
      <Receipt aria-hidden className="size-4 text-text-secondary" />
      <span className="font-medium tabular-nums">{bill.bill_no ?? b(`type.${bill.bill_type}`)}</span>
      <span className="tabular-nums">{formatINR(bill.total_paise)}</span>
      {state}
    </Link>
  );
}
