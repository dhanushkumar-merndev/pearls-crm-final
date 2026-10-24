import { z } from "zod";
import {
  computeLine,
  HSN_SAC_PATTERN,
  LineError,
  optionalCode,
  optionalDecimal,
  optionalItem,
  optionalPaise,
  optionalText,
  requiredDecimal,
  requiredItem,
  requiredPaise,
  requiredReason,
  requiredText,
} from "@pearl/shared";

/** One bill line as the editor holds it. Paths: lines.<i>.<field>. */
const lineSchema = (taxInclusive: boolean) =>
  z
    .object({
      kind: z.string(),
      medicine: z.unknown().optional(),
      batch_id: z.string().nullable().optional(),
      description: requiredText(300),
      hsn_sac: optionalCode(HSN_SAC_PATTERN, "hsn"),
      rate_paise: requiredPaise(),
      qty: requiredDecimal(0.001, 100_000, 3),
      discount_type: z.enum(["amount", "percent"]),
      discount_amount: optionalPaise(),
      discount_percent: optionalDecimal(0, 100, 2),
      gst_rate_bp: z.number({ error: "gst" }).int().min(0).max(4000),
    })
    .superRefine((l, ctx) => {
      if (l.kind === "pharmacy") {
        if (!l.medicine) ctx.addIssue({ code: "custom", path: ["medicine"], message: "choose" });
        else if (!l.batch_id) ctx.addIssue({ code: "custom", path: ["batch_id"], message: "errors.batch_required" });
      }
      const discountValue = l.discount_type === "percent" ? Math.round((l.discount_percent ?? 0) * 100) : (l.discount_amount ?? 0);
      try {
        computeLine({
          ratePaise: l.rate_paise,
          qtyMilli: Math.round(l.qty * 1000),
          discountType: l.discount_type,
          discountValue,
          gstRateBp: l.gst_rate_bp,
          taxInclusive,
        });
      } catch (e) {
        if (e instanceof LineError && e.message === "discount_exceeds_gross") {
          ctx.addIssue({ code: "custom", path: [l.discount_type === "percent" ? "discount_percent" : "discount_amount"], message: "bill.discountTooBig" });
        }
      }
    });

/** Draft bill / admin amend: at least one line; an amendment needs a reason. */
export const billSchema = ({ taxInclusive, amend }: { taxInclusive: boolean; amend: boolean }) =>
  z.object({
    doctor: optionalItem(),
    referred_by: optionalText(120),
    lines: z.array(lineSchema(taxInclusive)).min(1, { error: "noRows" }).max(200, { error: "tooMany" }),
    reason: amend ? requiredReason(300) : z.unknown(),
  });

const payRow = z.object({ key: z.string(), mode: optionalItem(), amount: optionalPaise(), reference: optionalText(80) });

/**
 * Finalize with payments now (any mix of modes) and advance use. Paid can't exceed what is due,
 * advance can't exceed the patient's credit; each amount needs its mode.
 */
export const finalizeSchema = ({ due, credit, needsReason }: { due: number; credit: number; needsReason: boolean }) =>
  z
    .object({
      use_advance: optionalPaise(),
      rows: z.array(payRow).max(10, { error: "tooMany" }),
      reason: needsReason ? requiredReason(300) : optionalText(300),
    })
    .superRefine((d, ctx) => {
      if ((d.use_advance ?? 0) > credit) ctx.addIssue({ code: "custom", path: ["use_advance"], message: "bill.advanceTooMuch" });
      d.rows.forEach((r, i) => {
        if ((r.amount ?? 0) > 0 && !r.mode) ctx.addIssue({ code: "custom", path: ["rows", i, "mode"], message: "choose" });
      });
      const paid = d.rows.reduce((s, r) => s + (r.amount ?? 0), 0) + (d.use_advance ?? 0);
      if (paid > due) ctx.addIssue({ code: "custom", path: ["rows", Math.max(d.rows.length - 1, 0), "amount"], message: "bill.overpaid" });
    });

export const PAYMENT_KINDS = ["payment", "advance", "refund"] as const;

/** A payment against a bill (not more than it owes), an advance, or a refund of the advance. */
export const paymentSchema = (outstanding: number | null) =>
  z
    .object({
      kind: z.enum(PAYMENT_KINDS, { error: "choose" }),
      mode: requiredItem(),
      amount: requiredPaise(1),
      reference: optionalText(80),
      note: optionalText(300),
    })
    .superRefine((d, ctx) => {
      if (d.kind === "payment" && outstanding !== null && d.amount > outstanding) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "payment.tooMuch" });
      }
    });

/** Use the patient's advance on a bill: more than ₹0, at most what is due and what is available. */
export const applyAdvanceSchema = (max: number) =>
  z.object({ amount: requiredPaise(1).refine((v) => v <= max, { error: "bill.advanceTooMuch" }) });
