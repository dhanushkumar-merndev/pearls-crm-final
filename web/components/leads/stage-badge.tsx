import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/ui/status-badge";
import { stageKind, type LeadStage } from "./types";

/** `editable`: the badge is a button that opens the stage dialog, so it shows a chevron. */
export function StageBadge({ stage, editable = false }: { stage: LeadStage; editable?: boolean }) {
  const t = useTranslations("leads.stage");
  return (
    <StatusBadge
      kind={stageKind(stage)}
      label={t(stage)}
      className={editable ? "pr-1.5 transition-colors group-hover:bg-popover-accent" : undefined}
    >
      {editable && <ChevronDown aria-hidden className="-ml-0.5 size-3.5 text-muted-foreground" />}
    </StatusBadge>
  );
}
