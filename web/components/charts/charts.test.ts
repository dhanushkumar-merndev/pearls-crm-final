import { describe, expect, it } from "vitest";
import { chartTokens, colorTokens } from "@pearl/shared";
import { direction, percentChange, sparklinePath } from "../kpi/sparkline";
import { assertSingleValueAxis, buildChartTheme, seriesColor } from "./chart-theme";
import { chartHeight, layoutOption } from "./layout";

describe("chart theme follows the tokens", () => {
  it.each(["dark", "light"] as const)("%s", (mode) => {
    const theme = buildChartTheme(mode);
    expect(theme.color).toEqual(chartTokens(mode).series);
    expect(theme.tooltip.backgroundColor).toBe(colorTokens(mode).raised);
    expect(theme.valueAxis.splitLine.lineStyle.color).toBe(chartTokens(mode).grid);
    // Text uses text colours, never a series colour.
    expect(chartTokens(mode).series).not.toContain(theme.textStyle.color);
    expect(theme.bar.itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
    expect(theme.line.lineStyle.width).toBe(2);
  });

  it("assigns series colours in fixed order and refuses a 9th", () => {
    expect(seriesColor("dark", 0)).toBe(chartTokens("dark").series[0]);
    expect(() => seriesColor("dark", 8)).toThrow(/Other/);
  });
});

describe("no dual-axis charts", () => {
  it("allows one value axis", () => {
    expect(() => assertSingleValueAxis({ xAxis: { type: "category" }, yAxis: { type: "value" } })).not.toThrow();
  });
  it("refuses two", () => {
    expect(() => assertSingleValueAxis({ yAxis: [{ type: "value" }, { type: "value" }] })).toThrow(/Dual-axis/);
  });
});

describe("KPI tile maths", () => {
  it("draws a sparkline across the box, highest value at the top", () => {
    expect(sparklinePath([0, 10], 100, 20, 0)).toBe("M0,20 L100,0");
    expect(sparklinePath([5, 5, 5], 100, 20, 0)).toBe("M0,10 L50,10 L100,10");
    expect(sparklinePath([], 100, 20)).toBe("");
  });

  it("computes change vs previous period", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
    expect(percentChange(5, 0)).toBeNull(); // no base → no %
    expect(percentChange(0, 0)).toBe(0);
    expect(direction(10)).toBe("up");
    expect(direction(-3)).toBe("down");
    expect(direction(0)).toBe("flat");
    expect(direction(null)).toBe("flat");
  });
});

describe("chart layout fits a phone", () => {
  const bars = { yAxis: { type: "category", data: ["A very long category name"] }, xAxis: { type: "value" }, series: [{ type: "bar", data: [1] }] };

  it("keeps labels inside the box instead of fixed left margins", () => {
    const o = layoutOption(bars, { width: 360, narrow: true }) as { grid: Record<string, unknown> };
    expect(o.grid).toMatchObject({ left: 4, outerBoundsMode: "same", outerBoundsContain: "axisLabel" });
  });

  it("cuts long category names and hides overlapping labels", () => {
    const o = layoutOption(bars, { width: 360, narrow: true }) as { yAxis: { axisLabel: Record<string, unknown> }; xAxis: { axisLabel: Record<string, unknown> } };
    expect(o.yAxis.axisLabel).toMatchObject({ width: 96, overflow: "truncate", hideOverlap: true });
    expect(o.xAxis.axisLabel).toMatchObject({ hideOverlap: true });
  });

  it("puts a wrapping legend under the plot on a narrow card, a wrapping one above it on a wide one", () => {
    const withLegend = { ...bars, legend: {} };
    const narrow = layoutOption(withLegend, { width: 360, narrow: true }) as { legend: Record<string, unknown>; grid: Record<string, unknown> };
    expect(narrow.legend).toMatchObject({ type: "plain", bottom: 0 });
    expect(narrow.grid.bottom).toBeGreaterThan(narrow.grid.top as number);
    const wide = layoutOption(withLegend, { width: 800, narrow: false }) as { legend: Record<string, unknown> };
    expect(wide.legend).toMatchObject({ type: "plain", top: 0 });
  });

  it("keeps room for a legend that wraps onto two rows", () => {
    const six = { ...bars, legend: {}, series: Array.from({ length: 6 }, (_, i) => ({ type: "bar", name: `Waiting for confirmation ${i}`, data: [1] })) };
    const o = layoutOption(six, { width: 520, narrow: false }) as { grid: Record<string, number> };
    expect(o.grid.top).toBeGreaterThanOrEqual(12 + 2 * 22);
  });

  it("value labels are plain text; a stacked bar hides its zeros", () => {
    const stacked = { ...bars, series: [{ type: "bar", stack: "s", data: [0], label: { show: true } }] };
    const o = layoutOption(stacked, { width: 800, narrow: false, labelColor: "L", textColor: "T" }) as { series: { label: Record<string, unknown> }[] };
    const label = o.series[0]!.label;
    expect(label).toMatchObject({ textBorderWidth: 0, textShadowBlur: 0, color: "T" });
    expect((label.formatter as (p: { value: number }) => string)({ value: 0 })).toBe("");
    expect((label.formatter as (p: { value: number }) => string)({ value: 3 })).toBe("3");
  });

  it("lets a chart keep its own grid values", () => {
    const o = layoutOption({ ...bars, grid: { right: 64 } }, { width: 800, narrow: false }) as { grid: Record<string, unknown> };
    expect(o.grid.right).toBe(64);
  });

  it("grows horizontal bar charts with their rows", () => {
    expect(chartHeight()).toBe(224);
    expect(chartHeight(1)).toBe(120);
    expect(chartHeight(10)).toBe(352);
  });
});
