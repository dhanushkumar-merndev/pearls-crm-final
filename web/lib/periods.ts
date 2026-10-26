import { istDateString } from "@pearl/shared";

/** Dashboard filter row (PLAN.md B6): Today / 7 days / Month-to-date / Last month / Custom. */
export const PRESETS = ["today", "7d", "mtd", "lastMonth", "custom"] as const;
export type Preset = (typeof PRESETS)[number];

/** IST calendar days for a preset ("custom" is handled by the caller). */
export function rangeFor(preset: Preset, now = new Date()): { from: string; to: string } {
  const today = istDateString(now);
  const back = (days: number) => istDateString(new Date(now.getTime() - days * 86_400_000));
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: back(6), to: today };
  if (preset === "mtd") return { from: `${today.slice(0, 7)}-01`, to: today };
  // last month
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return { from: `${py}-${String(pm).padStart(2, "0")}-01`, to: `${py}-${String(pm).padStart(2, "0")}-${last}` };
}

/** n of d as a percentage with one decimal (0 when there is nothing to divide by). */
export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
