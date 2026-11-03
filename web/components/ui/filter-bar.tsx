"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

/**
 * A row of filters. From the "sm" width up they are always shown; on a phone they fold behind
 * one Filters button so the list starts near the top. Fields line up on their bottom edge, so a
 * button (Refresh, Clear) sits level with the inputs without margin tricks. With `onClear`, a
 * small round ✕ after the filters puts them back to how the page opened (shown only when changed).
 *
 * Phone (owner, 03/11/2026): one row: search box (its label read aloud only), then the Filters,
 * ✕ and `actions` buttons as round icons (their words stay their accessible names). The folded
 * filters open on their own line below.
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
  /** Never folded away: first in the row (phone and wider). */
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
    // From "sm" up the inner boxes are `display: contents`, so search, filters and actions share one wrapping row.
    <div className={cn("flex flex-wrap items-end gap-2 sm:gap-3", className)}>
      {search && <div className="min-w-0 flex-1 max-sm:[&_label]:sr-only max-sm:[&>*]:w-full sm:contents">{search}</div>}
      <div className={cn("flex items-center gap-2 sm:hidden", !search && "flex-1")}>
        <Button
          variant="secondary"
          size="icon"
          className="relative"
          aria-label={active > 0 ? t("filtersOn", { n: active }) : t("filters")}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          <SlidersHorizontal aria-hidden />
          {active > 0 && (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.75rem] font-bold text-primary-foreground"
            >
              {active}
            </span>
          )}
        </Button>
        {clear}
        {/* Round icon buttons on a phone: the text is shrunk to nothing but stays the button's name. */}
        {actions && (
          <div className="flex items-center gap-2 [&_button]:size-10 [&_button]:gap-0 [&_button]:px-0 [&_button]:text-[0px]">{actions}</div>
        )}
      </div>
      <div id={id} className={cn("basis-full flex-wrap items-end gap-3 sm:contents", open ? "flex" : "hidden")}>
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
