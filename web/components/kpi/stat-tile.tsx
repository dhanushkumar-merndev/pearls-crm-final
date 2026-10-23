import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { direction, percentChange, sparklinePath } from "./sparkline";

export interface StatTileProps {
  label: string;
  /** Already formatted for display, e.g. "₹1,50,000.00" or "42". */
  value: string;
  current?: number;
  previous?: number;
  /** Is "up" good (revenue) or bad (no-shows)? Decides the arrow's colour. */
  goodWhen?: "up" | "down";
  trend?: number[];
}

/** Headline number + change vs previous period + sparkline. Change = arrow + words, not colour alone. */
export function StatTile({ label, value, current, previous, goodWhen = "up", trend }: StatTileProps) {
  const t = useTranslations("kpi");
  const change = current !== undefined && previous !== undefined ? percentChange(current, previous) : undefined;
  const dir = change === undefined ? undefined : direction(change);
  const good = dir && dir !== "flat" && dir === goodWhen;
  const pct = change == null ? "" : `${Math.abs(change).toFixed(change !== 0 && Math.abs(change) < 10 ? 1 : 0)}%`;

  return (
    <div className="flex min-h-32 flex-col justify-between gap-2 rounded-2xl border border-border bg-card p-4">
      <p className="text-[0.95rem] text-text-secondary">{label}</p>
      <div className="flex items-end justify-between gap-3">
        <p className="text-[1.9rem] leading-none font-semibold tracking-tight">{value}</p>
        {trend && trend.length > 1 && (
          <svg width="88" height="32" viewBox="0 0 88 32" aria-hidden className="shrink-0 text-chart-1">
            <path d={sparklinePath(trend, 88, 32)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        )}
      </div>
      {dir && (
        <p className={cn("flex items-center gap-1 text-[0.9rem]", dir === "flat" ? "text-muted-foreground" : good ? "text-good-text" : "text-bad-text")}>
          {dir === "up" ? <ArrowUp aria-hidden className="size-4" /> : dir === "down" ? <ArrowDown aria-hidden className="size-4" /> : <Minus aria-hidden className="size-4" />}
          <span>
            {dir === "flat" ? t("noChange") : t(dir, { value: pct })} <span className="text-muted-foreground">{t("vsPrevious")}</span>
          </span>
        </p>
      )}
    </div>
  );
}
