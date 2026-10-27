"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * A row of filters. From the "sm" width up they are always shown; on a phone they fold behind
 * one "Filters" button so the list starts near the top. Fields line up on their bottom edge, so a
 * button (Refresh, Clear) sits level with the inputs without margin tricks.
 */
export function FilterBar({
  children,
  actions,
  active = 0,
  className,
}: {
  children: ReactNode;
  /** Always visible beside the toggle (e.g. Refresh). */
  actions?: ReactNode;
  /** How many filters are set (shown on the phone toggle). */
  active?: number;
  className?: string;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2 sm:hidden">
        <Button variant="secondary" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          <SlidersHorizontal aria-hidden />
          {active > 0 ? t("filtersOn", { n: active }) : t("filters")}
        </Button>
        {actions}
      </div>
      <div id={id} className={cn("flex-wrap items-end gap-3 sm:flex", open ? "flex" : "hidden")}>
        {children}
        {actions && <div className="hidden items-end gap-2 sm:flex">{actions}</div>}
      </div>
    </div>
  );
}
