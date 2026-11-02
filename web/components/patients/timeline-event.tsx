"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatINR } from "@pearl/shared";

/** One patient_timeline item: `ref` carries the facts (amount, mode, bill number, IP number, …). */
export interface TimelineItem {
  at: string;
  id: string;
  kind: string;
  title: string;
  ref: Record<string, unknown> | null;
}

export interface PaymentRef {
  payment_id: string;
  kind: "payment" | "advance" | "refund";
  amount_paise: number;
  mode: string | null;
  reference: string | null;
  note: string | null;
  cancelled: boolean;
  bills: { bill_id: string; bill_no: string | null; amount_paise: number }[];
}

const link = "text-link underline-offset-4 hover:underline";

/** The bill numbers a payment went to, each linking to its bill. */
export function PaidBills({ bills }: { bills: PaymentRef["bills"] }) {
  return (
    <>
      {bills.map((b, i) => (
        <span key={b.bill_id}>
          {i > 0 && ", "}
          <Link href={`/bills/${b.bill_id}`} className={link}>
            {b.bill_no ?? "—"}
          </Link>
        </span>
      ))}
    </>
  );
}

/**
 * One short, translated line per event, e.g. "Payment ₹3,000.00 · UPI · for DEMO/26-27/39",
 * "Final bill DEMO/26-27/39 · ₹18,000.00", "Admitted · IP /26-27/51 · Semi deluxe room".
 * Kinds without facts fall back to the server's title.
 */
export function TimelineEventLine({ e }: { e: TimelineItem }) {
  const t = useTranslations("patientFile.line");
  const b = useTranslations("bill");
  const a = useTranslations("appt");
  const r = (e.ref ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  const num = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : 0);
  let line: ReactNode = e.title;
  let struck = false;

  if (e.kind === "payment" && str("kind")) {
    const p = r as unknown as PaymentRef;
    struck = p.cancelled;
    line = (
      <>
        {t(`pay.${p.kind}`, { amount: formatINR(p.amount_paise) })}
        {p.mode && ` · ${p.mode}`}
        {p.bills.length > 0 && (
          <>
            {" · "}
            {t("for")} <PaidBills bills={p.bills} />
          </>
        )}
        {p.reference && ` · ${t("ref", { ref: p.reference })}`}
        {p.cancelled && ` · ${t("cancelled")}`}
      </>
    );
  } else if (e.kind === "bill" && str("bill_type")) {
    struck = str("status") === "cancelled";
    line = (
      <>
        {b(`type.${str("bill_type")}`)}{" "}
        <Link href={`/bills/${str("bill_id")}`} className={link}>
          {str("bill_no")}
        </Link>
        {` · ${formatINR(num("total_paise"))}`}
        {str("ip_number") && ` · ${t("ip", { ip: str("ip_number")! })}`}
        {struck && ` · ${t("cancelled")}`}
      </>
    );
  } else if (e.kind === "admission" && str("ip_number")) {
    const cancelled = str("event") === "cancelled";
    struck = cancelled;
    line = (
      <>
        {cancelled ? t("admissionCancelled") : t("admitted")}
        {" · "}
        <Link href={`/admissions/${str("admission_id")}`} className={link}>
          {t("ip", { ip: str("ip_number")! })}
        </Link>
        {str("room") && ` · ${str("room")}`}
      </>
    );
  } else if (e.kind === "discharge" && str("ip_number")) {
    line = (
      <>
        {t("discharged")}
        {" · "}
        <Link href={`/admissions/${str("admission_id")}`} className={link}>
          {t("ip", { ip: str("ip_number")! })}
        </Link>
        {` · ${t("nights", { n: num("nights") })}`}
      </>
    );
  } else if (e.kind === "appointment" && str("status")) {
    line = [t("appointment"), str("doctor"), a(`status.${str("status")}`)].filter(Boolean).join(" · ");
  }
  return <p className={struck ? "font-medium text-text-secondary line-through" : "font-medium"}>{line}</p>;
}
