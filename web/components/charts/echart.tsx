"use client";

import { ChartColumn, ChartNoAxesColumn, Table2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { chartTokens, colorTokens, type ThemeMode } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle, Skeleton } from "@/components/ui/card";
import { assertSingleValueAxis, buildChartTheme, type ChartTheme } from "./chart-theme";
import { chartHeight, layoutOption, NARROW_CHART_PX, type ChartContext } from "./layout";

export type { ChartContext };

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
}

export interface EChartProps {
  title: string;
  description?: string;
  /**
   * Build the option from the theme so colours follow dark/light. Memoise it (useCallback):
   * a new function redraws the chart. `ctx.width` is the chart's measured width.
   */
  option: (theme: ChartTheme, mode: ThemeMode, ctx: ChartContext) => Record<string, unknown>;
  /** Same data as a table — always available ("View as table"). */
  table: ChartTable;
  height?: number;
  /** Horizontal bars: one row per category; the chart grows with the rows (no squashed bars). */
  rows?: number;
  /** Nothing to draw: a short "No data for this period" note instead of empty axes. */
  empty?: boolean;
}

/**
 * The only way to draw a chart in this app. Loads ECharts on demand, follows the
 * theme, resizes with its card (and re-lays out on a phone-width card), describes itself to
 * screen readers, and always offers the numbers as a table. One chart instance per card:
 * new data updates it in place; only a theme change rebuilds it.
 */
export function EChart({ title, description, option, table, height, rows, empty = false }: EChartProps) {
  const t = useTranslations("chart");
  const c = useTranslations("common");
  const { resolvedTheme } = useTheme();
  const mode: ThemeMode = resolvedTheme === "light" ? "light" : "dark";
  const container = useRef<HTMLDivElement>(null);
  const [showTable, setShowTable] = useState(false);
  const [chart, setChart] = useState<{ setOption(o: unknown, opts?: unknown): void } | null>(null);
  // Width in 40 px steps: enough to re-lay out (legend place, label width) without redrawing on every pixel.
  const [width, setWidth] = useState(0);
  const headingId = useId();
  const drawn = !showTable && !empty;
  const boxHeight = height ?? chartHeight(rows);

  // Make (and later dispose) the chart instance: only when it appears or the theme changes.
  useEffect(() => {
    if (!drawn || !container.current) return;
    let disposed = false;
    let instance: { dispose(): void; resize(): void; setOption(o: unknown, opts?: unknown): void } | undefined;
    let observer: ResizeObserver | undefined;
    void import("./echarts-core").then(({ echarts }) => {
      const el = container.current;
      if (disposed || !el) return;
      const made = echarts.init(el, buildChartTheme(mode), { renderer: "svg" });
      instance = made;
      observer = new ResizeObserver(() => {
        made.resize();
        const w = Math.round(el.clientWidth / 40) * 40;
        setWidth((old) => (old === w ? old : w));
      });
      observer.observe(el);
      setWidth(Math.round(el.clientWidth / 40) * 40);
      setChart(made);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.dispose();
      setChart(null);
    };
  }, [mode, drawn]);

  // Draw (or redraw) the data into the existing instance.
  useEffect(() => {
    if (!chart || width === 0) return;
    const theme = buildChartTheme(mode);
    const ctx: ChartContext = { width, narrow: width < NARROW_CHART_PX, labelColor: chartTokens(mode).label, textColor: colorTokens(mode).text };
    const built = option(theme, mode, ctx);
    assertSingleValueAxis(built);
    chart.setOption({ aria: { enabled: true, label: { description: title } }, ...layoutOption(built, ctx) }, { notMerge: true });
  }, [chart, mode, option, title, width]);

  return (
    <Card aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle id={headingId}>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {!empty && (
          <Button variant="ghost" className="-ml-3 self-start sm:ml-0" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? <ChartColumn aria-hidden /> : <Table2 aria-hidden />}
            {showTable ? t("viewChart") : t("viewTable")}
          </Button>
        )}
      </div>

      {empty ? (
        <p className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-text-secondary">
          <ChartNoAxesColumn aria-hidden className="size-5" />
          {c("noData")}
        </p>
      ) : showTable ? (
        <div className="overflow-x-auto">
          <table className="tabular w-full border-collapse text-left text-[0.95rem]">
            <thead>
              <tr>
                {table.columns.map((col) => (
                  <th key={col} scope="col" className="border-b border-border px-3 py-2 font-semibold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" style={{ height: boxHeight }}>
          {!chart && (
            <>
              <Skeleton className="absolute inset-0" />
              <span className="sr-only">{t("loading")}</span>
            </>
          )}
          <div ref={container} className="absolute inset-0" />
        </div>
      )}
    </Card>
  );
}
