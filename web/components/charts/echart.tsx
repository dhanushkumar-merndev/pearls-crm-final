"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { ThemeMode } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle, Skeleton } from "@/components/ui/card";
import { assertSingleValueAxis, buildChartTheme, type ChartTheme } from "./chart-theme";

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
}

export interface EChartProps {
  title: string;
  description?: string;
  /** Build the option from the theme so colours follow dark/light. */
  option: (theme: ChartTheme, mode: ThemeMode) => Record<string, unknown>;
  /** Same data as a table — always available ("View as table"). */
  table: ChartTable;
  height?: number;
}

/**
 * The only way to draw a chart in this app. Loads ECharts on demand, follows the
 * theme, resizes with its card, describes itself to screen readers, and always
 * offers the numbers as a table.
 */
export function EChart({ title, description, option, table, height = 280 }: EChartProps) {
  const t = useTranslations("chart");
  const { resolvedTheme } = useTheme();
  const mode: ThemeMode = resolvedTheme === "light" ? "light" : "dark";
  const container = useRef<HTMLDivElement>(null);
  const [showTable, setShowTable] = useState(false);
  const [ready, setReady] = useState(false);
  const headingId = useId();

  useEffect(() => {
    if (showTable || !container.current) return;
    let disposed = false;
    let chart: { dispose(): void; resize(): void } | undefined;
    let observer: ResizeObserver | undefined;

    void import("./echarts-core").then(({ echarts }) => {
      if (disposed || !container.current) return;
      const theme = buildChartTheme(mode);
      const built = option(theme, mode);
      assertSingleValueAxis(built);
      const instance = echarts.init(container.current, theme, { renderer: "svg" });
      instance.setOption({ aria: { enabled: true, label: { description: title } }, ...built });
      chart = instance;
      observer = new ResizeObserver(() => instance.resize());
      observer.observe(container.current);
      setReady(true);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [mode, option, showTable, title]);

  return (
    <Card aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle id={headingId}>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <Button variant="ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? <ChartColumn aria-hidden /> : <Table2 aria-hidden />}
          {showTable ? t("viewChart") : t("viewTable")}
        </Button>
      </div>

      {showTable ? (
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
        <div className="relative" style={{ height }}>
          {!ready && <Skeleton className="absolute inset-0" aria-label={t("loading")} />}
          <div ref={container} className="absolute inset-0" />
        </div>
      )}
    </Card>
  );
}
