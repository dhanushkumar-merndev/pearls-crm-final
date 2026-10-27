/**
 * Layout defaults every chart gets (PLAN.md B6), so a chart fits a phone-width card too:
 * - labels are kept inside the chart box (no fixed left margins that waste half a phone screen),
 * - the legend wraps above the plot (room is kept for its rows); on a narrow card it wraps under it instead,
 * - value labels are plain text in the label colour (no outline); a stacked bar hides its zero labels,
 * - axis labels that would overlap are hidden, long category names are cut with "…".
 * Pure function: tested in charts.test.ts.
 */

/** Below this width (px) a chart lays itself out for a phone. */
export const NARROW_CHART_PX = 380;

export interface ChartContext {
  /** Measured width of the chart (px, in 40 px steps). */
  width: number;
  narrow: boolean;
  /** Theme colours for value labels (set by <EChart>; tokens only). */
  labelColor?: string;
  textColor?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Default height (px), or for horizontal bars: grows with the number of rows. */
export function chartHeight(rows?: number): number {
  if (rows === undefined) return 224;
  return Math.max(120, rows * 28 + 72);
}

function axis(a: unknown, which: "x" | "y", { narrow, width }: ChartContext): unknown {
  if (!isObj(a)) return a;
  const label = isObj(a.axisLabel) ? a.axisLabel : {};
  const extra: Obj = { hideOverlap: true };
  // Category names on the left (horizontal bars): up to a third of the chart, cut with "…" beyond
  // (full name in the tooltip).
  if (which === "y" && a.type === "category")
    Object.assign(extra, { width: narrow ? 96 : Math.max(120, Math.min(200, Math.round(width * 0.32))), overflow: "truncate" });
  return { ...a, axisLabel: { ...extra, ...label } };
}

/** Rough legend rows at this width (12 px text ≈ 7 px a letter, plus the swatch and gap). */
function legendRows(names: string[], width: number): number {
  const need = names.reduce((sum, n) => sum + n.length * 7 + 34, 0);
  return Math.max(1, Math.ceil(need / Math.max(width - 16, 120)));
}

function seriesLabels(series: unknown, ctx: ChartContext): unknown {
  if (!Array.isArray(series)) return series;
  return series.map((s) => {
    if (!isObj(s) || !isObj(s.label) || !s.label.show) return s;
    const stacked = Boolean(s.stack);
    const label: Obj = {
      textBorderWidth: 0,
      textShadowBlur: 0,
      fontSize: 12,
      // Outside the bar: the quiet label colour; inside a stacked bar: the text colour.
      color: stacked ? ctx.textColor : ctx.labelColor,
      ...(stacked && !s.label.formatter ? { formatter: (p: { value: unknown }) => (Number(p.value) ? String(p.value) : "") } : {}),
      ...s.label,
    };
    return { ...s, label };
  });
}

export function layoutOption(option: Obj, ctx: ChartContext): Obj {
  const { narrow, width } = ctx;
  const hasLegend = Boolean(option.legend);
  const bottomLegend = hasLegend && narrow;
  const names = Array.isArray(option.series) ? option.series.map((s) => (isObj(s) && typeof s.name === "string" ? s.name : "")).filter(Boolean) : [];
  const rows = hasLegend ? legendRows(names, width) : 0;
  const out: Obj = { ...option };
  if (hasLegend) {
    out.legend = {
      ...(bottomLegend ? { type: "plain", bottom: 0, left: 0 } : { type: "plain", top: 0, left: 0 }),
      ...(isObj(option.legend) ? option.legend : {}),
    };
  }
  if (option.series && !option.radar) {
    out.grid = {
      left: 4,
      right: 16,
      top: rows > 0 && !bottomLegend ? 12 + rows * 22 : 12,
      bottom: bottomLegend ? 12 + rows * 22 : 4,
      // = the old grid.containLabel: axis labels stay inside the box.
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
      ...(isObj(option.grid) ? option.grid : {}),
    };
    out.series = seriesLabels(option.series, ctx);
  }
  if (option.xAxis) out.xAxis = axis(option.xAxis, "x", ctx);
  if (option.yAxis) out.yAxis = axis(option.yAxis, "y", ctx);
  return out;
}
