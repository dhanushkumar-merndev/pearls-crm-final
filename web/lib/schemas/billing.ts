import { z } from "zod";
import {
  computeLine,
  dateNearToday,
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
const lineSchema = (taxInclusive: boolean, maxDiscountBp: number | null) =>
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
        const line = computeLine({
          ratePaise: l.rate_paise,
          qtyMilli: Math.round(l.qty * 1000),
          discountType: l.discount_type,
          discountValue,
          gstRateBp: l.gst_rate_bp,
          taxInclusive,
        });
        // Reception's limit (billing → receptionist_max_discount_bp), the same check as the database's.
        if (maxDiscountBp !== null && line.grossPaise > 0 && line.discountPaise * 10000 > line.grossPaise * maxDiscountBp) {
          ctx.addIssue({ code: "custom", path: [l.discount_type === "percent" ? "discount_percent" : "discount_amount"], message: "bill.discountOverLimit" });
        }
      } catch (e) {
        if (e instanceof LineError && e.message === "discount_exceeds_gross") {
          ctx.addIssue({ code: "custom", path: [l.discount_type === "percent" ? "discount_percent" : "discount_amount"], message: "bill.discountTooBig" });
        }
      }
    });

/**
 * Draft bill / admin amend: at least one line; an amendment needs a reason. `maxDiscountBp`: reception's
 * discount limit per line (null for an admin, who has none).
 */
export const billSchema = ({ taxInclusive, amend, maxDiscountBp = null }: { taxInclusive: boolean; amend: boolean; maxDiscountBp?: number | null }) =>
  z.object({
    doctor: optionalItem(),
    referred_by: optionalText(120),
    // The bill's date: today when made; any day within a year either way (owner 27/11/2026). Amend keeps it.
    bill_date: amend ? z.unknown() : dateNearToday(),
    lines: z.array(lineSchema(taxInclusive, maxDiscountBp)).min(1, { error: "noRows" }).max(200, { error: "tooMany" }),
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
      /** An advance for one treatment (a package part payment), or "" for none. */
      treatment: z.union([z.literal(""), z.uuid({ error: "choose" })]).default(""),
    })
    .superRefine((d, ctx) => {
      if (d.kind === "payment" && outstanding !== null && d.amount > outstanding) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "payment.tooMuch" });
      }
    });

/** Use the patient's advance on a bill: more than ₹0, at most what is due and what is available. */
export const applyAdvanceSchema = (max: number) =>
  z.object({ amount: requiredPaise(1).refine((v) => v <= max, { error: "bill.advanceTooMuch" }) });

/**
 * "What is this bill for?" before a new bill: a visit (`appointment:<id>`), a session done without a
 * booking (`session:<id>`), a whole treatment (`treatment:<id>`), an IP stay (`admission:<id>`), or `none`.
 */
export const billTargetSchema = z.object({
  target: z.string().regex(/^(none|(appointment|session|treatment|admission):[0-9a-f-]{36})$/, { error: "choose" }),
});
export type BillTarget = z.infer<typeof billTargetSchema>["target"];

/** The create_bill links for a chosen target. */
export function billTargetLinks(target: BillTarget): Record<string, string> {
  if (target === "none") return {};
  const [kind, id] = target.split(":") as [string, string];
  return { [`${kind}_id`]: id };
}

/** New breakdown bill: what it is for (a treatment `t:<id>`, a stay `s:<id>`, other bills, or empty). */
export const breakdownTargetSchema = z.object({
  target: z.string().regex(/^(t:[0-9a-f-]{36}|s:[0-9a-f-]{36}|other|empty)$/, { error: "choose" }),
});

const breakdownLineSchema = z.object({
  key: z.string(),
  category: z.unknown(),
  description: requiredText(300),
  service_date: z.string(),
  qty: requiredDecimal(0.001, 9_999_999),
  unit_paise: optionalPaise(),
  amount_paise: requiredPaise(0),
  gst_rate_bp: z.number().int().min(0).max(4000),
  source_bill_item_id: z.string().nullable(),
});

/**
 * Breakdown bill (insurance): every line needs a name and an amount; the total is free (owner, 17/11:
 * it may differ from what was billed). Finalize needs at least one line; an amendment needs a reason.
 */
export const breakdownSchema = ({ needLine, amend }: { needLine: boolean; amend: boolean }) =>
  z.object({
    bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "required" }),
    insurer: optionalText(120),
    tpa: optionalText(120),
    policy_no: optionalText(60),
    claim_no: optionalText(60),
    notes: optionalText(1000),
    lines: z
      .array(breakdownLineSchema)
      .max(300, { error: "tooMany" })
      .refine((l) => !needLine || l.length > 0, { error: "breakdown.needLine" }),
    reason: amend ? requiredReason(300) : z.unknown(),
  });

/** New discharge summary from the Bills tab: an IP stay (`ip:<id>`) or an OP visit / session (`op:<visit>|<session>`). */
export const pickSummaryTargetSchema = z.object({
  target: z.string().regex(/^(ip:[0-9a-f-]{36}|op:([0-9a-f-]{36})?\|([0-9a-f-]{36})?)$/, { error: "choose" }),
});
