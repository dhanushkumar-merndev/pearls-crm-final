import { z } from "zod";
import { istDateString, optionalDate, optionalPaise, optionalText, requiredInt, requiredPaise, requiredText } from "@pearl/shared";

/** One quotation line: a treatment from the price list (or typed), how many, the price for one. */
const quoteLine = z.object({
  treatment: z.object({ id: z.string() }).nullable(),
  name: requiredText(200),
  qty: requiredInt(1, 100),
  price: requiredPaise(0),
});

/**
 * A sales quotation (owner, 20/11/2026): treatments + total, valid till, a note. The discount can't
 * be more than the lines add up to; valid till can't be in the past. The database checks it again.
 */
export const quotationSchema = (today: () => string = () => istDateString(new Date())) =>
  z
    .object({
      items: z.array(quoteLine).min(1, { error: "noRows" }).max(20, { error: "tooMany" }),
      discount: optionalPaise(),
      validUntil: optionalDate().refine((v) => !v || v >= today(), { error: "notPast" }),
      note: optionalText(500),
    })
    .superRefine((v, ctx) => {
      const subtotal = v.items.reduce((s, i) => s + i.qty * i.price, 0);
      if ((v.discount ?? 0) > subtotal) ctx.addIssue({ code: "custom", path: ["discount"], message: "leads.quote.discountTooBig" });
    });

export const quoteSubtotal = (items: { qty: number | string; price: number | null }[]) =>
  items.reduce((s, i) => s + (Number(i.qty) || 0) * (i.price ?? 0), 0);
