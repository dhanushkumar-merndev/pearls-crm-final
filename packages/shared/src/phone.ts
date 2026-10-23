export interface NormalizedPhone {
  /** E.164, e.g. "+919845012345" */
  e164: string;
  /** Last 10 digits, used for search and matching */
  last10: string;
  /**
   * Starts with 6–9, like every Indian mobile. A hint only: some landlines
   * (Bengaluru 080-…) look the same by digits, so WhatsApp sending relies on
   * the patient's WhatsApp number + opt-in, never on this flag alone.
   */
  isIndianMobile: boolean;
}

/**
 * Accepts the ways people type Indian numbers: "+91 98450 12345", "098450-12345",
 * "9845012345", "0091 9845012345", "080 4123 4567" (landline). Numbers starting
 * with "+" and another country code are kept as international.
 * Returns null when it can't be a valid number.
 */
export function normalizePhone(input: string): NormalizedPhone | null {
  const raw = input.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");

  if (raw.startsWith("+") && !digits.startsWith("91")) {
    if (digits.length < 8 || digits.length > 15) return null;
    return { e164: `+${digits}`, last10: digits.slice(-10), isIndianMobile: false };
  }

  let national = digits;
  if (national.startsWith("0091")) national = national.slice(4);
  else if (national.length === 12 && national.startsWith("91")) national = national.slice(2);
  else if (national.length === 11 && national.startsWith("0")) national = national.slice(1);

  if (!/^[1-9]\d{9}$/.test(national)) return null;
  return {
    e164: `+91${national}`,
    last10: national,
    isIndianMobile: /^[6-9]/.test(national),
  };
}
