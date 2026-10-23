import type { StatusKind } from "@pearl/shared";

/** Lead stages in the order the sales team works them (PLAN.md C2). */
export const LEAD_STAGES = [
  "new", "contacted", "interested", "consultation_booked", "consulted", "surgery_scheduled", "converted",
  "not_reachable", "lost", "junk",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export function stageKind(stage: LeadStage): StatusKind {
  if (stage === "converted") return "good";
  if (stage === "lost" || stage === "junk") return "critical";
  if (stage === "not_reachable") return "serious";
  return "warning";
}

export interface Lead {
  id: string;
  sl_no: number;
  lead_date: string;
  name: string;
  phone_e164: string;
  alt_phone_e164: string | null;
  email: string | null;
  treatment_template_id: string | null;
  treatment: string | null;
  treatment_text: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  source_id: string | null;
  source_label: string | null;
  referred_by_text: string | null;
  appointment_mode: "offline" | "online" | null;
  surgery_date: string | null;
  next_followup_at: string | null;
  amount_quoted_paise: number | null;
  amount_finalised_paise: number | null;
  amount_finalised_at: string | null;
  comments1: string | null;
  comments2: string | null;
  stage: LeadStage;
  lost_reason_id: string | null;
  lost_reason: string | null;
  patient_id: string | null;
  uhid: string | null;
  duplicate_of_id: string | null;
  created_via: string;
  last_activity_at: string;
  amount_locked: boolean;
  version: number;
}

export interface SalesStaff {
  id: string;
  full_name: string;
  role: "sales_executive" | "sales_manager";
}
