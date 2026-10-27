"use client";

import { ChevronsDown, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "./button";

/**
 * The one "Load more" button under a list (keyset feeds). Shows a spinner while the next page
 * loads; renders nothing when there is no next page.
 */
export function LoadMore({
  hasMore,
  loading,
  onClick,
  children,
}: {
  hasMore: boolean | undefined;
  loading?: boolean;
  onClick: () => void;
  /** A different label ("Older messages"); default "Load more". */
  children?: ReactNode;
}) {
  const t = useTranslations("common");
  if (!hasMore) return null;
  return (
    <Button variant="secondary" className="self-start" onClick={onClick} disabled={loading}>
      {loading ? <LoaderCircle aria-hidden className="animate-spin" /> : <ChevronsDown aria-hidden />}
      {children ?? t("loadMore")}
    </Button>
  );
}
