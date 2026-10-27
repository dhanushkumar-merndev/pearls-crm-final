import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { direction, percentChange, sparklinePath } from "./sparkline";

export interface StatTileProps {
  label: string;
  /** Already formatted for display, e.g. "₹1,50,000.00" or "42". Keep it a number, not a sentence. */
  value: string;
  /** One short line under the value ("62% delivered · 40% read"). */
  hint?: string;
  current?: number;
  previous?: number;
  /** Is "up" good (revenue) or bad (no-shows)? Decides the arrow's colour. */
  goodWhen?: "up" | "down";
  trend?: number[];
}

/**
 * Headline number + change vs previous period + sparkline. Change = arrow + words, not colour alone.
 * The value shrinks with its tile (a lakh amount fits a phone-width tile); the sparkline sits under it.
 */
export function StatTile({ label, value, hint, current, previous, goodWhen = "up", trend }: StatTileProps) {
  const t = useTranslations("kpi");
  const change = current !== undefined && previous !== undefined ? percentChange(current, previous) : undefined;
  const dir = change === undefined ? undefined : direction(change);
  const good = dir && dir !== "flat" && dir === goodWhen;
  const pct = change == null ? "" : `${Math.abs(change).toFixed(change !== 0 && Math.abs(change) < 10 ? 1 : 0)}%`;
  const spark = trend && trend.length > 1;

  return (
    <div className={cn("@container flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border bg-card p-4", spark && "min-h-28")}>
      <p className="text-[0.95rem] text-text-secondary">{label}</p>
      <p className="text-[clamp(1.15rem,11cqi,1.6rem)] leading-tight font-semibold tracking-tight tabular-nums break-words">{value}</p>
      {hint && <p className="text-[0.9rem] text-text-secondary">{hint}</p>}
      {spark && (
        <svg viewBox="0 0 88 24" preserveAspectRatio="none" aria-hidden className="h-6 w-full max-w-40 text-chart-1">
          <path
            d={sparklinePath(trend, 88, 24)}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {dir && (
        <p className={cn("mt-auto flex items-start gap-1 text-[0.9rem]", dir === "flat" ? "text-muted-foreground" : good ? "text-good-text" : "text-bad-text")}>
          {dir === "up" ? <ArrowUp aria-hidden className="mt-0.5 size-4 shrink-0" /> : dir === "down" ? <ArrowDown aria-hidden className="mt-0.5 size-4 shrink-0" /> : <Minus aria-hidden className="mt-0.5 size-4 shrink-0" />}
          <span>
            {dir === "flat" ? t("noChange") : t(dir, { value: pct })} <span className="text-muted-foreground">{t("vsPrevious")}</span>
          </span>
        </p>
      )}
    </div>
  );
}
