import type { BillStatus, BillType } from "@/components/bills/types";
import type { BreakdownLineRow } from "@/lib/breakdown-bill";

/** A finalized bill as the picker and the "filled from" list show it. */
export interface BillChip {
  id: string;
  bill_no: string | null;
  bill_type: BillType;
  status: BillStatus;
  bill_at: string | null;
  total_paise: number;
}

/** What a breakdown is filled from (stored tidy by the database). */
export interface BreakdownSources {
  treatment_id?: string | null;
  admission_id?: string | null;
  session_ids?: string[];
  bill_ids?: string[];
}

/** breakdown_card */
export interface BreakdownBill {
  id: string;
  patient_id: string;
  patient: string;
  uhid: string;
  treatment_id: string | null;
  treatment: string | null;
  admission_id: string | null;
  ip_number: string | null;
  sources: BreakdownSources;
  bb_no: string | null;
  status: BillStatus;
  version: number;
  bill_date: string;
  doctor_id: string | null;
  doctor: string | null;
  insurer: string | null;
  tpa: string | null;
  policy_no: string | null;
  claim_no: string | null;
  notes: string | null;
  total_paise: number;
  billed_ref_paise: number;
  /** What the chosen bills come to now (reference only). */
  billed_now_paise: number;
  finalized_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  lines: BreakdownLineRow[];
  source_bills: BillChip[];
  sessions: { id: string; seq: number; date: string }[];
}

/** breakdown_sources */
export interface SourcesData {
  treatments: {
    id: string;
    name: string;
    category: string;
    status: string;
    start_date: string;
    doctor: string | null;
    sessions: { id: string; seq: number; planned_date: string; actual_date: string | null; status: string; bills: BillChip[] }[];
    bills: BillChip[];
    stays: StaySource[];
  }[];
  stays: StaySource[];
  other_bills: BillChip[];
  breakdowns: { id: string; bb_no: string | null; status: BillStatus; treatment_id: string | null; admission_id: string | null; total_paise: number; created_at: string }[];
}

export interface StaySource {
  id: string;
  ip_number: string;
  admitted_at: string;
  discharged_at: string | null;
  status: string;
  bills: BillChip[];
}

/** Where the dialog starts from (a bill page, an IP stay, a treatment). */
export interface BreakdownPreset {
  treatment_id?: string | null;
  admission_id?: string | null;
  session_id?: string | null;
  bill_id?: string | null;
}
