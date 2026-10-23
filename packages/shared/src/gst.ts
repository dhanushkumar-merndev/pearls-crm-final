import { divRound, toSafeNumber, assertPaise, type Paise } from "./money";

/**
 * Bill-line maths, PLAN.md C5. The database computes the authoritative values
 * with the same rules; both are tested against test-vectors/gst.json.
 *
 * Units (all integers, no floats):
 *   ratePaise      price per unit in paise
 *   qtyMilli       quantity × 1000 (1.5 strips = 1500)
 *   discountValue  paise when discountType = "amount"; basis points (1% = 100) when "percent"
 *   gstRateBp      GST rate in basis points (5% = 500, 18% = 1800)
 */
export type DiscountType = "amount" | "percent";

export interface LineInput {
  ratePaise: Paise;
  qtyMilli: number;
  discountType: DiscountType;
  discountValue: number;
  gstRateBp: number;
  taxInclusive: boolean;
}

export interface LineResult {
  grossPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  taxPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  totalPaise: Paise;
}

export class LineError extends Error {}

export function computeLine(input: LineInput): LineResult {
  const { ratePaise, qtyMilli, discountType, discountValue, gstRateBp, taxInclusive } = input;
  assertPaise(ratePaise, "rate");
  if (ratePaise < 0) throw new LineError("negative_rate");
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli <= 0) throw new LineError("invalid_quantity");
  if (!Number.isSafeInteger(gstRateBp) || gstRateBp < 0 || gstRateBp > 4000) {
    throw new LineError("invalid_gst_rate");
  }
  if (!Number.isSafeInteger(discountValue) || discountValue < 0) {
    throw new LineError("invalid_discount");
  }

  const gross = divRound(BigInt(ratePaise) * BigInt(qtyMilli), 1000n);

  let discount: bigint;
  if (discountType === "percent") {
    if (discountValue > 10_000) throw new LineError("discount_exceeds_gross");
    discount = divRound(gross * BigInt(discountValue), 10_000n);
  } else {
    discount = BigInt(discountValue);
  }
  if (discount > gross) throw new LineError("discount_exceeds_gross");

  const net = gross - discount;
  const rate = BigInt(gstRateBp);
  let taxable: bigint;
  let tax: bigint;
  if (taxInclusive) {
    taxable = divRound(net * 10_000n, 10_000n + rate);
    tax = net - taxable;
  } else {
    taxable = net;
    tax = divRound(taxable * rate, 10_000n);
  }
  // Odd paisa goes to SGST.
  const cgst = tax / 2n;
  const sgst = tax - cgst;

  return {
    grossPaise: toSafeNumber(gross),
    discountPaise: toSafeNumber(discount),
    taxablePaise: toSafeNumber(taxable),
    taxPaise: toSafeNumber(tax),
    cgstPaise: toSafeNumber(cgst),
    sgstPaise: toSafeNumber(sgst),
    totalPaise: toSafeNumber(taxable + tax),
  };
}

export interface BillTotals extends LineResult {
  roundOffPaise: Paise;
  payablePaise: Paise;
}

/** Sums lines. With roundToRupee, adds a separate "Round off" amount to reach a whole rupee. */
export function computeBillTotals(lines: LineResult[], roundToRupee = false): BillTotals {
  const sum = (key: keyof LineResult) => lines.reduce((acc, line) => acc + line[key], 0);
  const totalPaise = sum("totalPaise");
  assertPaise(totalPaise, "total");
  const roundOffPaise = roundToRupee
    ? toSafeNumber(divRound(BigInt(totalPaise), 100n) * 100n) - totalPaise
    : 0;
  return {
    grossPaise: sum("grossPaise"),
    discountPaise: sum("discountPaise"),
    taxablePaise: sum("taxablePaise"),
    taxPaise: sum("taxPaise"),
    cgstPaise: sum("cgstPaise"),
    sgstPaise: sum("sgstPaise"),
    totalPaise,
    roundOffPaise,
    payablePaise: totalPaise + roundOffPaise,
  };
}
