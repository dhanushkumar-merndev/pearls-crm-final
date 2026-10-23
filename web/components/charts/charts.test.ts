import { describe, expect, it } from "vitest";
import { chartTokens, colorTokens } from "@pearl/shared";
import { direction, percentChange, sparklinePath } from "../kpi/sparkline";
import { assertSingleValueAxis, buildChartTheme, seriesColor } from "./chart-theme";

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
