import type { DiscountType } from "@pearl/shared";

export type BillType = "procedure_receipt" | "pharmacy_invoice" | "final_bill";
export type BillStatus = "draft" | "finalized" | "cancelled";

export interface BillItem {
  id: string;
  line_no: number;
  kind: string;
  category_id: string | null;
  category: string | null;
  category_code: string | null;
  service_id: string | null;
  pharmacy_item_id: string | null;
  batch_id: string | null;
  room_type_id: string | null;
  doctor_id: string | null;
  description: string;
  hsn_sac: string | null;
  mfg: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  service_date: string | null;
  rate_paise: number;
  qty: number;
  discount_type: DiscountType;
  discount_value: number;
  gst_rate_bp: number;
  gross_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  total_paise: number;
  carried_from_item_id: string | null;
}

export interface Bill {
  id: string;
  bill_type: BillType;
  bill_no: string | null;
  status: BillStatus;
  patient_id: string;
  patient: string;
  uhid: string;
  doctor_id: string | null;
  doctor: string | null;
  referred_by_text: string | null;
  treatment_id: string | null;
  admission_id: string | null;
  tax_inclusive: boolean;
  gross_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  round_off_paise: number;
  total_paise: number;
  carried_in_paise: number;
  agreed_price_paise: number | null;
  below_agreed_reason: string | null;
  bill_at: string | null;
  created_at: string;
  notes: string | null;
  version: number;
  cancel_reason: string | null;
  received_paise: number;
  patient_credit_paise?: number;
  items: BillItem[];
}

export const payable = (b: Pick<Bill, "total_paise" | "carried_in_paise">) => b.total_paise + b.carried_in_paise;
