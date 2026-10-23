/**
 * India Standard Time helpers. IST is a fixed UTC+05:30 with no daylight saving,
 * so we shift the instant and read UTC fields — no timezone database needed.
 * The server computes "today" and financial-year boundaries the same way.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

export function istParts(instant: Date): IstParts {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO calendar date in IST, e.g. "2026-10-23" (what `*_date` columns store). */
export function istDateString(instant: Date): string {
  const p = istParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "23/10/2026" */
export function formatDate(instant: Date): string {
  const p = istParts(instant);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** "10:56 AM" */
export function formatTime(instant: Date): string {
  const { hour, minute } = istParts(instant);
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${suffix}`;
}

/** "23/10/2026 10:56 AM" */
export function formatDateTime(instant: Date): string {
  return `${formatDate(instant)} ${formatTime(instant)}`;
}

/** The UTC instant of IST midnight that starts the given IST calendar date ("2026-10-23"). */
export function istDayStart(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("invalid_date");
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) - IST_OFFSET_MS);
}

export interface FinancialYear {
  /** Calendar year the FY starts in (1 April). */
  startYear: number;
  /** "2026-27" — stored in number_series.fy */
  label: string;
  /** "26-27" — printed in bill numbers like PAC/26-27/964 */
  short: string;
}

/** Indian financial year (1 April – 31 March), decided by the IST date. */
export function financialYear(instant: Date): FinancialYear {
  const { year, month } = istParts(instant);
  const startYear = month >= 4 ? year : year - 1;
  const end = (startYear + 1) % 100;
  return {
    startYear,
    label: `${startYear}-${pad(end)}`,
    short: `${pad(startYear % 100)}-${pad(end)}`,
  };
}
