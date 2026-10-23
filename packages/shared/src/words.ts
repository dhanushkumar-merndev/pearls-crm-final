import { assertPaise, type Paise } from "./money";

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  return n % 10 === 0 ? tens : `${tens} ${ONES[n % 10]}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(" ");
}

/**
 * Whole number in the Indian system (crore, lakh, thousand, hundred).
 * 15000000 → "One Crore Fifty Lakh". Amounts of 100 crore and above repeat
 * the scale ("One Hundred Crore").
 */
export function numberToIndianWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid_number");
  if (n === 0) return ONES[0]!;
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  let rest = n % 10_000_000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/**
 * Amount for bills: 15000050 → "Rupees One Lakh Fifty Thousand and Fifty Paise Only".
 * Always derived from the stored total — never typed by hand.
 */
export function amountInWords(paise: Paise): string {
  assertPaise(paise);
  if (paise < 0) throw new Error("negative_amount");
  const rupees = Math.floor(paise / 100);
  const fraction = paise % 100;
  const rupeeWords = `Rupees ${numberToIndianWords(rupees)}`;
  return fraction
    ? `${rupeeWords} and ${belowHundred(fraction)} Paise Only`
    : `${rupeeWords} Only`;
}
