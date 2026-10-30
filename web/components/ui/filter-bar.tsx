"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

/**
 * A row of filters. From the "sm" width up they are always shown; on a phone they fold behind
 * one "Filters" button so the list starts near the top. Fields line up on their bottom edge, so a
 * button (Refresh, Clear) sits level with the inputs without margin tricks. With `onClear`, a
 * small round ✕ after the filters puts them back to how the page opened (shown only when changed).
 */
export function FilterBar({
  children,
  search,
  actions,
  active = 0,
  onClear,
  canClear = false,
  className,
}: {
  children: ReactNode;
  /** Never folded away: above the toggle on a phone, first in the filter row from "sm" up. */
  search?: ReactNode;
  /** Always visible beside the toggle (e.g. Refresh). */
  actions?: ReactNode;
  /** How many filters are set (shown on the phone toggle). */
  active?: number;
  /** Puts every filter back to its starting value. */
  onClear?: () => void;
  /** Something differs from the starting filters (the ✕ shows only then). */
  canClear?: boolean;
  className?: string;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const id = useId();
  const clear = onClear && <ClearFilters show={canClear} onClear={onClear} />;
  return (
    // From "sm" up the inner filter box is `display: contents`, so search, filters and actions share one wrapping row.
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end", className)}>
      {search}
      <div className="flex flex-wrap items-center gap-2 sm:hidden">
        <Button variant="secondary" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          <SlidersHorizontal aria-hidden />
          {active > 0 ? t("filtersOn", { n: active }) : t("filters")}
        </Button>
        {clear}
        {actions}
      </div>
      <div id={id} className={cn("flex-wrap items-end gap-3 sm:contents", open ? "flex" : "hidden")}>
        {children}
        {onClear && canClear && <div className="hidden sm:flex">{clear}</div>}
        {actions && <div className="hidden items-end gap-2 sm:flex">{actions}</div>}
      </div>
    </div>
  );
}

/** Small round ✕ that puts a page's filters back to how it opened; nothing when they are unchanged. */
export function ClearFilters({ show, onClear }: { show: boolean; onClear: () => void }) {
  const t = useTranslations("common");
  if (!show) return null;
  return (
    <Tooltip label={t("clearFilters")} side="top">
      <Button variant="secondary" size="icon" className="size-9" aria-label={t("clearFilters")} onClick={onClear}>
        <X aria-hidden />
      </Button>
    </Tooltip>
  );
}
