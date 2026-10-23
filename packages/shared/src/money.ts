/**
 * Money is always an integer number of paise (₹1 = 100 paise). Never use floats
 * for amounts. Intermediate maths uses BigInt so rate × quantity can't overflow.
 */
export type Paise = number;

export function assertPaise(value: number, field = "amount"): asserts value is Paise {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field}_not_integer_paise`);
  }
}

/**
 * Integer division rounded half away from zero (₹0.005 → ₹0.01, −₹0.005 → −₹0.01).
 * This is the single rounding rule for every money calculation (PLAN.md C5).
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("division_by_zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

export function toSafeNumber(value: bigint, field = "amount"): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`${field}_too_large`);
  }
  return Number(value);
}

/** "1,50,000.50" / "150000.5" / 1500 → paise. Rejects more than 2 decimals. */
export function rupeesToPaise(input: string | number): Paise {
  const text = String(input).trim().replace(/[₹,\s]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("invalid_amount");
  const [, sign, whole, fraction = ""] = match;
  const paise = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return toSafeNumber(sign ? -paise : paise);
}

/** Groups digits the Indian way: 12345678 → "1,23,45,678". */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

export interface FormatOptions {
  /** Show the ₹ sign (default true). */
  symbol?: boolean;
  /** Always show paise as .00 (default true). */
  decimals?: boolean;
}

/** Short form for chart axes and tiles: 15000000 → "₹1.5L", 2500000000 → "₹2.5Cr", 1250000 → "₹12.5K". */
export function formatINRShort(paise: Paise): string {
  assertPaise(paise);
  const rupees = Math.abs(paise) / 100;
  const sign = paise < 0 ? "-" : "";
  const fmt = (n: number, unit: string) => `${sign}₹${Number(n.toFixed(n < 100 ? 1 : 0))}${unit}`;
  if (rupees >= 10_000_000) return fmt(rupees / 10_000_000, "Cr");
  if (rupees >= 100_000) return fmt(rupees / 100_000, "L");
  if (rupees >= 1_000) return fmt(rupees / 1_000, "K");
  return `${sign}₹${Math.round(rupees)}`;
}

/** 15000050 → "₹1,50,000.50" */
export function formatINR(paise: Paise, options: FormatOptions = {}): string {
  assertPaise(paise);
  const { symbol = true, decimals = true } = options;
  const negative = paise < 0;
  const abs = BigInt(Math.abs(paise));
  const rupees = groupIndian((abs / 100n).toString());
  const fraction = (abs % 100n).toString().padStart(2, "0");
  const body = decimals || fraction !== "00" ? `${rupees}.${fraction}` : rupees;
  return `${negative ? "-" : ""}${symbol ? "₹" : ""}${body}`;
}
