/** Strip expiry as printed on the pack: "2027-03-31" → "03/2027". */
export function expiryLabel(iso: string | null | undefined): string {
  return iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
}

/** Stock quantities: whole numbers plainly, fractions with up to 3 decimals. */
export function qtyLabel(qty: number | string | null | undefined): string {
  const n = Number(qty ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "");
}

export interface SaleBatch {
  id: string;
  batch_no: string;
  expiry_date: string;
  qty_on_hand: number;
  mrp_paise: number;
  selling_price_paise: number;
  expired: boolean;
}
