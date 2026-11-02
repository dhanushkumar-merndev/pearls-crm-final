"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, IndianRupee } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatDate, formatINR } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { rpc } from "@/lib/rpc";
import type { BillType } from "./types";

interface Dues {
  total_due_paise: number;
  bills: { id: string; bill_no: string | null; bill_type: BillType; bill_at: string | null; ip_number: string | null; total_paise: number; due_paise: number }[];
}

/**
 * Patient header: "Balance due ₹…" in yellow when finalized bills are not fully paid. One bill →
 * the button opens it (to add the payment there); several → a list, each opening its bill.
 * Shows nothing when nothing is due. Reception and admin only (Postgres checks the same).
 */
export function DuesButton({ patientId }: { patientId: string }) {
  const t = useTranslations("patientFile");
  const b = useTranslations("bill");
  const dues = useQuery({
    queryKey: ["patient_dues", patientId],
    queryFn: () => rpc<Dues>("patient_dues", { p_patient_id: patientId }),
    // Coming back from a bill after a payment, an advance or a cancel: always fresh.
    staleTime: 0,
  });
  const d = dues.data;
  if (!d || d.total_due_paise <= 0 || d.bills.length === 0) return null;
  const label = (
    <>
      <IndianRupee aria-hidden />
      {t("balanceDue", { amount: formatINR(d.total_due_paise) })}
    </>
  );
  const yellow = "text-status-warning";
  if (d.bills.length === 1) {
    return (
      <Button variant="secondary" className={yellow} asChild>
        <Link href={`/bills/${d.bills[0]!.id}`} data-testid="patient-dues">
          {label}
        </Link>
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className={yellow} data-testid="patient-dues">
          {label}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-72">
        <DropdownMenuLabel>{t("billsDue", { n: d.bills.length })}</DropdownMenuLabel>
        {d.bills.map((x) => (
          <DropdownMenuItem key={x.id} asChild>
            <Link href={`/bills/${x.id}`} className="flex items-start justify-between gap-4">
              <span className="flex flex-col">
                <span className="font-medium">
                  {b(`type.${x.bill_type}`)} · {x.bill_no}
                </span>
                <span className="text-[0.9rem] text-text-secondary">
                  {[x.ip_number && t("ipStay", { ip: x.ip_number }), x.bill_at && formatDate(new Date(x.bill_at))].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className={`font-semibold tabular-nums ${yellow}`}>{formatINR(x.due_paise)}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
