import { z } from "zod";
import {
  istDateString,
  optionalDecimal,
  optionalPaise,
  optionalText,
  requiredChoice,
  requiredDate,
  requiredDecimal,
  requiredItem,
  requiredPaise,
  requiredReason,
  requiredText,
} from "@pearl/shared";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One supplier-invoice line. Paths: lines.<i>.<field>. */
const purchaseLine = z
  .object({
    key: z.string(),
    item: requiredItem(),
    batch_no: requiredText(40),
    expiry: z
      .string({ error: "required" })
      .min(1, { error: "required", abort: true })
      .regex(MONTH, { error: "date" }),
    qty: requiredDecimal(0.001, 1_000_000, 3),
    free_qty: optionalDecimal(0, 1_000_000, 3),
    purchase_price_paise: requiredPaise(),
    mrp_paise: optionalPaise(),
    selling_price_paise: optionalPaise(),
    gst_rate_bp: z.number({ error: "gst" }).int().min(0).max(4000),
  })
  .superRefine((l, ctx) => {
    // Expiry is the strip's month; it can be sold through that month's last day.
    if (MONTH.test(l.expiry) && `${l.expiry}-31` < istDateString(new Date())) {
      ctx.addIssue({ code: "custom", path: ["expiry"], message: "errors.expired_batch" });
    }
    if (l.mrp_paise && l.selling_price_paise && l.selling_price_paise > l.mrp_paise) {
      ctx.addIssue({ code: "custom", path: ["selling_price_paise"], message: "pharmacy.sellingAboveMrp" });
    }
  });

/** Supplier invoice (draft / post). The same medicine + batch appears once. */
export const purchaseSchema = z
  .object({
    supplier: requiredItem(),
    invoice_no: requiredText(60),
    invoice_date: requiredDate().refine((d) => d <= istDateString(new Date()), { error: "notFuture" }),
    notes: optionalText(500),
    lines: z.array(purchaseLine).min(1, { error: "noRows" }).max(200, { error: "tooMany" }),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.lines.forEach((l, i) => {
      const k = `${l.item}|${l.batch_no.toUpperCase()}|${l.expiry}`;
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["lines", i, "batch_no"], message: "duplicateValue" });
      seen.add(k);
    });
  });

export const ADJUST_KINDS = ["damaged", "expired", "supplier_return", "patient_return", "count_correction"] as const;
const REMOVES = new Set<string>(["damaged", "expired", "supplier_return"]);

/** Stock adjustment: a counted quantity may be 0; a removal can't take more than is on hand. */
export const adjustStockSchema = (onHand: number) =>
  z
    .object({
      kind: requiredChoice(ADJUST_KINDS),
      qty: requiredDecimal(0, 1_000_000, 3),
      reason: requiredReason(300),
    })
    .superRefine((d, ctx) => {
      if (d.kind !== "count_correction" && d.qty <= 0) ctx.addIssue({ code: "custom", path: ["qty"], message: "errors.invalid_quantity" });
      if (REMOVES.has(d.kind) && d.qty > onHand) ctx.addIssue({ code: "custom", path: ["qty"], message: "errors.stock_insufficient" });
    });

export const pickPatientSchema = z.object({ patient: requiredItem() });
