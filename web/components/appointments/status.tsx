"use client";

import { useTranslations } from "next-intl";
import type { StatusKind } from "@pearl/shared";
import { StatusBadge } from "@/components/ui/status-badge";

export type ApptStatus =
  | "pending_confirmation" | "confirmed" | "arrived" | "with_doctor" | "done" | "no_show" | "cancelled" | "rescheduled";

const KIND: Record<ApptStatus, StatusKind> = {
  pending_confirmation: "warning",
  confirmed: "good",
  arrived: "good",
  with_doctor: "good",
  done: "good",
  no_show: "critical",
  cancelled: "serious",
  rescheduled: "serious",
};

/** Status = icon + words (never colour alone). */
export function ApptStatusBadge({ status, className }: { status: ApptStatus; className?: string }) {
  const t = useTranslations("appt.status");
  return <StatusBadge kind={KIND[status]} label={t(status)} className={className} />;
}

/** The next steps reception can take from each status (mirrors private.appt_transition_ok). */
export const NEXT: Record<ApptStatus, ApptStatus[]> = {
  pending_confirmation: ["confirmed", "arrived", "no_show", "cancelled"],
  confirmed: ["arrived", "no_show", "cancelled"],
  arrived: ["with_doctor", "done", "cancelled"],
  with_doctor: ["done"],
  no_show: ["arrived"],
  done: [],
  cancelled: [],
  rescheduled: [],
};
