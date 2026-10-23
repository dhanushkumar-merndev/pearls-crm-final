import { chartTokens, colorTokens, type ThemeMode } from "@pearl/shared";

/**
 * ECharts theme built from tokens.json (PLAN.md B6): fixed categorical order,
 * recessive grid/axes, text in text colours (never series colours), thin marks
 * with 4 px rounded data ends, 2 px lines, ≥ 8 px markers.
 */
export function buildChartTheme(mode: ThemeMode) {
  const c = colorTokens(mode);
  const ch = chartTokens(mode);
  const axis = {
    axisLine: { show: true, lineStyle: { color: ch.axis } },
    axisTick: { show: false },
    axisLabel: { color: ch.label, fontSize: 13 },
    splitLine: { show: false, lineStyle: { color: ch.grid, width: 1 } },
    nameTextStyle: { color: ch.label },
  };
  return {
    color: [...ch.series],
    backgroundColor: "transparent",
    textStyle: { color: c.textSecondary, fontFamily: "Inter, system-ui, sans-serif", fontSize: 13 },
    title: { textStyle: { color: c.text }, subtextStyle: { color: c.textSecondary } },
    legend: { textStyle: { color: c.textSecondary, fontSize: 13 }, itemWidth: 12, itemHeight: 12, icon: "roundRect" },
    tooltip: {
      backgroundColor: c.raised,
      borderColor: c.borderStrong,
      borderWidth: 1,
      textStyle: { color: c.text, fontSize: 14 },
      extraCssText: "border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);",
      axisPointer: { lineStyle: { color: ch.axis }, crossStyle: { color: ch.axis } },
    },
    categoryAxis: axis,
    valueAxis: { ...axis, axisLine: { show: false }, splitLine: { show: true, lineStyle: { color: ch.grid } } },
    timeAxis: axis,
    bar: { itemStyle: { borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 },
    line: { lineStyle: { width: 2 }, symbolSize: 8, symbol: "circle", showSymbol: false, smooth: false },
    gauge: { axisLine: { lineStyle: { color: [[1, ch.grid]] } } },
  };
}

export type ChartTheme = ReturnType<typeof buildChartTheme>;

/** Dual-axis charts are not allowed (PLAN.md B6): split into two charts instead. */
export function assertSingleValueAxis(option: { yAxis?: unknown; xAxis?: unknown }): void {
  const count = (axis: unknown) => (Array.isArray(axis) ? axis.length : axis ? 1 : 0);
  if (count(option.yAxis) > 1 || count(option.xAxis) > 1) {
    throw new Error("Dual-axis charts are not allowed — use two charts or small multiples.");
  }
}

/** Colour for the n-th series, in the fixed order. Past the palette, fold into "Other". */
export function seriesColor(mode: ThemeMode, index: number): string {
  const series = chartTokens(mode).series;
  if (index >= series.length) throw new Error("Too many series — fold the rest into 'Other'.");
  return series[index]!;
}
