import { istDateString } from "@pearl/shared";

/**
 * Pure helpers behind components/ui/date-picker.tsx. Values stay the strings the screens already
 * use ("YYYY-MM-DD", "YYYY-MM-DDTHH:mm", "HH:mm", "YYYY-MM"). The calendar works with local
 * `Date`s made from the calendar parts, so a day never shifts with the browser's time zone.
 */

const pad = (n: number) => String(n).padStart(2, "0");

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDateString(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** "2026-11-02" → local Date at midnight (undefined when empty or not a real date). */
export function isoToDate(value: string | null | undefined): Date | undefined {
  const m = ISO_DATE.exec(value ?? "");
  if (!m || !isIsoDateString(value!)) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Local Date → "2026-11-02". */
export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-11-02" → "02/11/2026" (CLAUDE.md: dates shown DD/MM/YYYY). Empty for anything else. */
export function displayDate(value: string | null | undefined): string {
  if (!value || !isIsoDateString(value)) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

/** "14:05" → "2:05 PM". Empty for anything else. */
export function displayTime(value: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})/.exec(value ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return "";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "2026-11-02T14:05" → { date: "2026-11-02", time: "14:05" } (empty parts when not set). */
export function splitDateTime(value: string | null | undefined): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value ?? "");
  return m ? { date: m[1]!, time: m[2]! } : { date: "", time: "" };
}

export function joinDateTime(date: string, time: string): string {
  return date && time ? `${date}T${time}` : "";
}

/** "2026-11-02T14:05" → "02/11/2026 2:05 PM". */
export function displayDateTime(value: string | null | undefined): string {
  const { date, time } = splitDateTime(value);
  return date ? `${displayDate(date)} ${displayTime(time)}` : "";
}

/**
 * Times for the time dropdown, every `step` minutes from 00:00. A current value that isn't on the
 * step (old data, e.g. 09:10) is added in order so it still shows as chosen. `min`/`max` ("HH:mm")
 * trim the list (the current value is always kept).
 */
export function timeOptions(step = 15, current = "", min?: string, max?: string): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += Math.max(1, step)) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  const inRange = (t: string) => (!min || t >= min) && (!max || t <= max);
  const list = out.filter(inRange);
  if (/^\d{2}:\d{2}$/.test(current) && !list.includes(current)) {
    list.push(current);
    list.sort();
  }
  return list;
}

/** "2026-11" → "Nov 2026" with the given short month names (Jan…Dec). */
export function displayMonth(value: string | null | undefined, monthNames: readonly string[]): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return "";
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${monthNames[i]} ${m[1]}` : "";
}

export function monthValue(year: number, monthIndex: number): string {
  return `${year}-${pad(monthIndex + 1)}`;
}

/** Quick choices in the range picker (all IST calendar days). */
export const QUICK_RANGES = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"] as const;
export type QuickRange = (typeof QUICK_RANGES)[number];

export function quickRange(kind: QuickRange, now = new Date()): { from: string; to: string } {
  const today = istDateString(now);
  const back = (days: number) => {
    const d = isoToDate(today)!;
    d.setDate(d.getDate() - days);
    return dateToIso(d);
  };
  switch (kind) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: back(1), to: back(1) };
    case "last7":
      return { from: back(6), to: today };
    case "last30":
      return { from: back(29), to: today };
    case "thisMonth":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "lastMonth": {
      const first = isoToDate(`${today.slice(0, 7)}-01`)!;
      const end = new Date(first.getFullYear(), first.getMonth(), 0);
      return { from: `${dateToIso(end).slice(0, 7)}-01`, to: dateToIso(end) };
    }
  }
}

/** Which quick choice (if any) a range equals, so the list can show it as chosen. */
export function matchQuickRange(from: string, to: string, now = new Date()): QuickRange | null {
  for (const k of QUICK_RANGES) {
    const r = quickRange(k, now);
    if (r.from === from && r.to === to) return k;
  }
  return null;
}

/** Puts a picked pair in order (a range picked "backwards" is still a range). */
export function orderRange(from: string, to: string): { from: string; to: string } {
  return from && to && from > to ? { from: to, to: from } : { from, to };
}
