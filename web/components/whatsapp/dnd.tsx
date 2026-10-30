"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { rpc } from "@/lib/rpc";
import { waDndSchema } from "@/lib/schemas/whatsapp";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

/** Who a chat is with: a patient, a lead, or a number that is neither yet. */
export interface ChatTarget {
  patientId?: string;
  leadId?: string;
  phone?: string;
}
interface Dnd {
  bot: boolean;
  auto: boolean;
}

const args = (t: ChatTarget) => ({ p_patient_id: t.patientId ?? null, p_lead_id: t.leadId ?? null, p_phone: t.phone ?? null });

/** Do not disturb for this number: the chat bot and/or automatic messages switched off. */
const dndKey = (t: ChatTarget) => ["wa_dnd", t.patientId ?? null, t.leadId ?? null, t.phone ?? null];

export function useDnd(target: ChatTarget, enabled = true) {
  return useQuery({
    queryKey: dndKey(target),
    enabled,
    queryFn: () => rpc<Dnd>("wa_dnd_get", args(target)),
  });
}

export function DndBadge({ dnd }: { dnd: Dnd | undefined }) {
  const t = useTranslations("whatsapp.dnd");
  if (!dnd || (!dnd.bot && !dnd.auto)) return null;
  return <StatusBadge kind="warning" label={t(dnd.bot && dnd.auto ? "badgeBoth" : dnd.bot ? "badgeBot" : "badgeAuto")} />;
}

export function DndDialog({ target, current, onDone }: { target: ChatTarget; current: Dnd | undefined; onDone: () => void }) {
  const t = useTranslations("whatsapp.dnd");
  const queryClient = useQueryClient();
  const { saved, failed } = useFeedback();
  const [bot, setBot] = useState(current?.bot ?? false);
  const [auto, setAuto] = useState(current?.auto ?? false);
  const checks = useZodForm(waDndSchema);
  const save = useMutation({
    mutationFn: (d: Dnd) => rpc<Dnd>("wa_dnd_set", { ...args(target), p_bot: d.bot, p_auto: d.auto }),
    onSuccess: (res) => {
      saved(t("saved"));
      // The save answers with the new state: the badge changes at once, without another round trip.
      queryClient.setQueryData(dndKey(target), res);
      void queryClient.invalidateQueries({ queryKey: ["wa_dnd"] });
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("title")}
      description={t("description")}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() => {
            const d = checks.validate({ bot, auto });
            if (d) save.mutate(d);
          }}
        >
          <BellOff aria-hidden />
          {save.isPending ? t("saving") : t("save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-1">
        <Checkbox label={t("bot")} hint={t("botHint")} checked={bot} onChange={(e) => setBot(e.target.checked)} />
        <Checkbox label={t("auto")} hint={t("autoHint")} checked={auto} onChange={(e) => setAuto(e.target.checked)} />
      </div>
    </DialogContent>
  );
}
