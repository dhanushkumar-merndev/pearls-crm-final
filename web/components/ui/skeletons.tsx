import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Skeleton } from "./card";

/** Screen-reader text for a loading block (tests also wait for it to go away). */
function LoadingLabel() {
  const t = useTranslations("common");
  return <span className="sr-only">{t("loading")}</span>;
}

/** Grey stand-ins for KPI tiles while the numbers load (same grid as the tiles). */
export function TileSkeletons({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div role="status" className={cn("grid grid-cols-2 gap-3 xl:grid-cols-4", className)}>
      <LoadingLabel />
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-7 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Stand-in for a card (chart or panel) while it loads. */
export function CardSkeleton({ height = 224, className }: { height?: number; className?: string }) {
  return (
    <div role="status" className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5", className)}>
      <LoadingLabel />
      <Skeleton className="h-5 w-1/3" />
      <Skeleton style={{ height }} />
    </div>
  );
}

/** Stand-in rows for a list or a table body (put inside a <tbody> with asRow). */
export function RowSkeletons({ rows = 5, cols = 1, asRow = false }: { rows?: number; cols?: number; asRow?: boolean }) {
  if (asRow) {
    return (
      <>
        {Array.from({ length: rows }, (_, i) => (
          <tr key={i} className="border-b border-border last:border-0">
            {Array.from({ length: cols }, (_, j) => (
              <td key={j} className="px-4 py-3">
                {i === 0 && j === 0 && <LoadingLabel />}
                <Skeleton className="h-5" />
              </td>
            ))}
          </tr>
        ))}
      </>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-2">
      <LoadingLabel />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}
