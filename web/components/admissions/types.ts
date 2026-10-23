import type { BillStatus, BillType } from "@/components/bills/types";

export type AdmissionStatus = "admitted" | "discharged" | "cancelled";

export interface Admission {
  id: string;
  patient_id: string;
  patient: string;
  uhid: string;
  gender: string;
  age: number | null;
  treatment_id: string | null;
  treatment: string | null;
  ip_number: string;
  admitted_at: string;
  discharged_at: string | null;
  room_type_id: string | null;
  room_type: string | null;
  room_rate_paise: number | null;
  room_label: string | null;
  room_days: number;
  attender_name: string | null;
  attender_phone: string | null;
  attender_relation: string | null;
  diagnosis: string | null;
  procedures: string[];
  anaesthesia: string | null;
  surgery_at: string | null;
  status: AdmissionStatus;
  notes: string | null;
  cancel_reason: string | null;
  version: number;
  surgeons: { doctor_id: string; role: "primary" | "assistant" | "visiting"; name: string }[];
  bills: { id: string; bill_type: BillType; bill_no: string | null; status: BillStatus; total_paise: number; bill_at: string | null; consolidated_into_id: string | null }[];
  summary: { id: string; status: "draft" | "finalized" | "cancelled"; version: number } | null;
}
