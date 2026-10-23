/**
 * SVG path for a stat-tile sparkline. Plain SVG (no chart library) so a page full
 * of KPI tiles stays light.
 */
export function sparklinePath(values: number[], width: number, height: number, pad = 2): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      // Flat series sit in the middle instead of on the floor.
      const y = max === min ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${round(x)},${round(y)}`;
    })
    .join(" ");
}

export type Direction = "up" | "down" | "flat";

/** Percent change vs the previous period, or null when there is no base to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function direction(change: number | null): Direction {
  if (change === null || Math.abs(change) < 0.05) return "flat";
  return change > 0 ? "up" : "down";
}
