"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { chartTokens, formatINR, formatINRShort, type ThemeMode } from "@pearl/shared";
import { EChart } from "@/components/charts/echart";
import type { ChartTheme } from "@/components/charts/chart-theme";

// SAMPLE data for the design preview only.
const HOURS = ["10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM"];
const TODAY = [3, 6, 8, 4, 3, 5, 7, 6, 4, 2];
const TYPICAL = [4, 5, 6, 4, 4, 5, 6, 6, 5, 3];
const DAYS = Array.from({ length: 14 }, (_, i) => `${String(10 + i).padStart(2, "0")}/10`);
// Daily revenue in ₹ thousands → paise (₹62,000 = 62 × 1000 × 100 paise).
const REVENUE_PAISE = [62, 71, 58, 80, 77, 69, 90, 85, 74, 95, 88, 79, 102, 97].map((k) => k * 1000 * 100);

export function DesignCharts() {
  const t = useTranslations("design");

  // Emphasis form: today in the accent colour, the typical day in grey (PLAN.md B6).
  const arrivals = useCallback(
    (_theme: ChartTheme, mode: ThemeMode) => ({
      legend: {},
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "category", data: HOURS },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        { name: t("arrivalsTypical"), type: "bar", data: TYPICAL, itemStyle: { color: chartTokens(mode).emphasisGray } },
        { name: t("arrivalsToday"), type: "bar", data: TODAY },
      ],
    }),
    [t],
  );

  // Single series: the title names it, so no legend box.
  const revenue = useCallback(
    () => ({
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => formatINR(v),
      },
      xAxis: { type: "category", data: DAYS, boundaryGap: false },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => formatINRShort(v) } },
      series: [{ name: t("revenue"), type: "line", data: REVENUE_PAISE, areaStyle: { opacity: 0.12 } }],
    }),
    [t],
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <EChart
        title={t("arrivalsTitle")}
        option={arrivals}
        table={{
          columns: [t("hour"), t("arrivalsToday"), t("arrivalsTypical")],
          rows: HOURS.map((h, i) => [h, TODAY[i]!, TYPICAL[i]!]),
        }}
      />
      <EChart
        title={t("revenueTitle")}
        option={revenue}
        table={{ columns: [t("day"), t("revenue")], rows: DAYS.map((d, i) => [d, formatINR(REVENUE_PAISE[i]!)]) }}
      />
    </div>
  );
}
