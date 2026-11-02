import { formatDate } from "@pearl/shared";
import type { BillStatus, BillType } from "@/components/bills/types";

/** What a bill is for (the server's `for`): keys that don't apply are left out. */
export interface BillFor {
  treatment_id?: string;
  treatment?: string;
  category?: string;
  session_id?: string;
  session_seq?: number;
  visit_id?: string;
  visit_date?: string;
  appointment_id?: string;
  admission_id?: string;
  ip_number?: string;
  doctor?: string;
}

/** A bill as a small chip on a session / visit / stay. */
export interface BillChipData {
  id: string;
  bill_no: string | null;
  bill_type: BillType;
  status: BillStatus;
  total_paise: number;
  received_paise: number;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * "Laser hair reduction · Session 3 · Dr Priya", "Visit 02/11/2026 · Dr Ravi", "IP stay IP-12", or null
 * when the bill is for nothing in particular.
 */
export function billForLabel(f: BillFor | null | undefined, t: Translate): string | null {
  if (!f) return null;
  const parts: string[] = [];
  if (f.treatment) parts.push(f.session_seq ? t("session", { treatment: f.treatment, n: f.session_seq }) : f.treatment);
  else if (f.visit_date) parts.push(t("visit", { date: formatDate(new Date(f.visit_date)) }));
  if (f.ip_number) parts.push(t("stay", { ip: f.ip_number }));
  if (parts.length === 0) return null;
  if (f.doctor) parts.push(f.doctor);
  return parts.join(" · ");
}
