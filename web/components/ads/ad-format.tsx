"use client";

import { useTranslations } from "next-intl";
import { formatDate, formatINR } from "@pearl/shared";
import { StatusBadge } from "@/components/ui/status-badge";

/** A YYYY-MM-DD day as DD/MM/YYYY. */
export const dayLabel = (d: string) => formatDate(new Date(`${d}T00:00:00+05:30`));

/** Counts the Indian way (1,23,456). */
export const num = (n: number) => n.toLocaleString("en-IN");

/** Cost per result in paise, or null when there is no result to divide by. */
export const ratio = (paise: number, n: number) => (n > 0 ? Math.round(paise / n) : null);

/** A cost that may not exist yet ("—"). */
export const money = (paise: number | null) => (paise === null ? "—" : formatINR(paise));

/** Money back per rupee spent ("3.2×"), "—" before any spend. */
export const roas = (collected: number, spend: number) => (spend > 0 ? `${(collected / spend).toFixed(1)}×` : "—");

/** Meta's delivery status as icon + words. */
export function CampaignStatus({ status, className }: { status: string | null; className?: string }) {
  const t = useTranslations("ads.adStatus");
  if (status === "ACTIVE") return <StatusBadge kind="good" label={t("active")} className={className} />;
  if (status?.includes("PAUSED")) return <StatusBadge kind="warning" label={t("paused")} className={className} />;
  if (status === "WITH_ISSUES" || status === "DISAPPROVED") return <StatusBadge kind="critical" label={t("problem")} className={className} />;
  if (status === "IN_PROCESS" || status === "PENDING_REVIEW") return <StatusBadge kind="warning" label={t("review")} className={className} />;
  return <StatusBadge kind="serious" label={t("off")} className={className} />;
}
