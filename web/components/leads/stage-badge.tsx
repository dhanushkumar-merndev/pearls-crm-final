import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/ui/status-badge";
import { stageKind, type LeadStage } from "./types";

export function StageBadge({ stage }: { stage: LeadStage }) {
  const t = useTranslations("leads.stage");
  return <StatusBadge kind={stageKind(stage)} label={t(stage)} />;
}
