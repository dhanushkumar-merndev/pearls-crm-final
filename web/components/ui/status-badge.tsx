import { CircleAlert, CircleCheck, CircleX, Clock, type LucideIcon } from "lucide-react";
import type { StatusKind } from "@pearl/shared";
import { cn } from "@/lib/utils";

const ICONS: Record<StatusKind, LucideIcon> = {
  good: CircleCheck,
  warning: Clock,
  serious: CircleAlert,
  critical: CircleX,
};

const ICON_COLOUR: Record<StatusKind, string> = {
  good: "text-status-good",
  warning: "text-status-warning",
  serious: "text-status-serious",
  critical: "text-status-critical",
};

/** Status is always icon + words, never colour alone ("Confirmed ✅", "Waiting ⏳"). */
export function StatusBadge({ kind, label, className }: { kind: StatusKind; label: string; className?: string }) {
  const Icon = ICONS[kind];
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-secondary px-3 text-[0.9rem] font-medium text-foreground",
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-4", ICON_COLOUR[kind])} />
      {label}
    </span>
  );
}
