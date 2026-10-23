// Same rules as packages/shared/src/phone.ts (kept in step by _shared/phone.test.ts, which
// runs the same cases as packages/shared/tests/phone.test.ts).

export interface NormalizedPhone {
  e164: string;
  last10: string;
  isIndianMobile: boolean;
}

/** "+91 98450 12345", "098450-12345", "9845012345", "0091 …" → +919845012345; other "+cc" kept. */
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
  return { e164: `+91${national}`, last10: national, isIndianMobile: /^[6-9]/.test(national) };
}
