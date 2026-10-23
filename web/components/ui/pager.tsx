"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "./button";

/** Offset paging for admin tables: "Rows 21–40 of 312" with Previous / Next. */
export function Pager({
  offset,
  limit,
  total,
  onOffset,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffset: (offset: number) => void;
}) {
  const t = useTranslations("common");
  if (total <= limit && offset === 0) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav aria-label={t("pages")} className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-text-secondary" aria-live="polite">
        {t("rowsOf", { from, to, total })}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
          <ChevronLeft aria-hidden />
          {t("previous")}
        </Button>
        <Button variant="secondary" disabled={to >= total} onClick={() => onOffset(offset + limit)}>
          {t("next")}
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
