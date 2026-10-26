"use client";

import { useTranslations } from "next-intl";
import type { StatusKind } from "@pearl/shared";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

export interface StorageUsage {
  db_bytes: number;
  db_limit_bytes: number;
  db_pct: number;
  files_bytes: number;
  files_limit_bytes: number;
  files_pct: number;
  writes_month: number;
  writes_limit: number;
  writes_pct: number;
  pct: number;
  level: "good" | "warning" | "serious" | "critical";
  by_purpose: { purpose: string; files: number; bytes: number }[];
}

const FILL: Record<StorageUsage["level"], string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  serious: "bg-status-serious",
  critical: "bg-status-critical",
};

const levelOf = (p: number): StorageUsage["level"] => (p >= 95 ? "critical" : p >= 85 ? "serious" : p >= 70 ? "warning" : "good");

/** 1.2 GB / 340 MB / 12 KB (base 1024, one decimal). */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(bytes) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/** Meters for the free-tier limits (PLAN.md F2), warning at 70 / 85 / 95 %. Level = icon + label + bar. */
export function StorageMeter({ usage }: { usage: StorageUsage }) {
  const t = useTranslations("storage");
  const rows = [
    { key: "db", used: formatBytes(usage.db_bytes), limit: formatBytes(usage.db_limit_bytes), pct: Number(usage.db_pct) },
    { key: "files", used: formatBytes(usage.files_bytes), limit: formatBytes(usage.files_limit_bytes), pct: Number(usage.files_pct) },
    { key: "writes", used: usage.writes_month.toLocaleString("en-IN"), limit: usage.writes_limit.toLocaleString("en-IN"), pct: Number(usage.writes_pct) },
  ];
  return (
    <div className="flex flex-col gap-3">
      <StatusBadge kind={usage.level as StatusKind} label={t(`level.${usage.level}`, { pct: usage.pct })} className="self-start" />
      {rows.map((r) => (
        <div key={r.key} className="flex flex-col gap-1">
          <div className="flex flex-wrap justify-between gap-2 text-[0.95rem]">
            <span>{t(r.key)}</span>
            <span className="tabular-nums text-text-secondary">{t("usedOf", { used: r.used, limit: r.limit, pct: r.pct })}</span>
          </div>
          <div
            role="meter"
            aria-label={t(r.key)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, r.pct)}
            aria-valuetext={`${r.pct}%`}
            className="h-3 overflow-hidden rounded-full bg-secondary"
          >
            <div className={cn("h-full rounded-full", FILL[levelOf(r.pct)])} style={{ width: `${Math.min(100, Math.max(r.pct, 1))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
