"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CirclePlus, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatDateTime, formatINR } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import type { Bill, BillType } from "./types";

interface Candidate {
  id: string;
  bill_no: string;
  bill_type: BillType;
  bill_at: string;
  total_paise: number;
  episode: boolean;
  carried: boolean;
}
export interface SuggestedLine {
  kind: string;
  description: string;
  rate_paise: number;
  qty: number;
  gst_rate_bp: number;
  [key: string]: unknown;
}
interface Autofill {
  candidates: Candidate[];
  stay: { admitted_at: string; discharged_at: string | null; room_days: number } | null;
  lines: SuggestedLine[];
}

/**
 * Final bill helpers (PLAN.md C6): choose the interim bills to carry in (each can go into one
 * final bill only), and add the stay's own charges (room × nights, IP services, surgeons).
 * Both save the draft first, so nothing typed is lost.
 */
export function FinalBillTools({
  bill,
  saveWith,
}: {
  bill: Bill;
  /** Saves the editor's lines plus `extra`, returning the saved bill. */
  saveWith: (extra?: SuggestedLine[]) => Promise<Bill>;
}) {
  const t = useTranslations("bill");
  const { saved, failed } = useFeedback();
  const router = useRouter();
  const queryClient = useQueryClient();
  const auto = useQuery({
    queryKey: ["final_bill_autofill", bill.id, bill.version],
    queryFn: () => rpc<Autofill>("final_bill_autofill", { p_bill_id: bill.id }),
  });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [lines, setLines] = useState<Set<number> | null>(null);
  const chosen = picked ?? new Set(auto.data?.candidates.filter((c) => c.carried).map((c) => c.id) ?? []);
  const chosenLines = lines ?? new Set(auto.data?.lines.map((_, i) => i) ?? []);

  const carry = useMutation({
    mutationFn: async () => {
      const b = await saveWith();
      return rpc<Bill>("set_carried_bills", { p_bill_id: bill.id, p_version: b.version, p_bill_ids: [...chosen] });
    },
    onSuccess: () => {
      saved(t("carriedUpdated"));
      void queryClient.invalidateQueries({ queryKey: ["bill", bill.id] });
      router.refresh();
    },
    onError: failed,
  });
  const addLines = useMutation({
    mutationFn: () => saveWith(auto.data!.lines.filter((_, i) => chosenLines.has(i))),
    onSuccess: () => saved(t("chargesAdded")),
    onError: failed,
  });

  if (!auto.data) return null;
  const { stay, candidates } = auto.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <CardTitle>{t("carryTitle")}</CardTitle>
        <p className="text-text-secondary">{t("carryHint")}</p>
        {candidates.length === 0 && <p>{t("noInterimBills")}</p>}
        <ul className="flex flex-col gap-2">
          {candidates.map((c) => (
            <li key={c.id}>
              <Checkbox
                checked={chosen.has(c.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setPicked(next);
                }}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.bill_no}</span>
                    <span className="text-text-secondary">
                      {t(`type.${c.bill_type}`)} · {formatDate(new Date(c.bill_at))}
                    </span>
                    <span className="tabular-nums">{formatINR(c.total_paise)}</span>
                    {c.episode && <StatusBadge kind="good" label={t("thisEpisode")} />}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
        {candidates.length > 0 && (
          <Button variant="secondary" className="self-start" disabled={carry.isPending} onClick={() => carry.mutate()}>
            <Link2 aria-hidden />
            {t("updateCarried", { n: chosen.size })}
          </Button>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t("stayCharges")}</CardTitle>
        {stay ? (
          <p className="text-text-secondary">
            {formatDateTime(new Date(stay.admitted_at))} – {stay.discharged_at ? formatDateTime(new Date(stay.discharged_at)) : t("stillAdmitted")} ·{" "}
            {t("nights", { n: stay.room_days })}
          </p>
        ) : (
          <p className="text-text-secondary">{t("noStay")}</p>
        )}
        {auto.data.lines.length === 0 && <p>{t("noSuggestions")}</p>}
        <ul className="flex flex-col gap-2">
          {auto.data.lines.map((l, i) => (
            <li key={i}>
              <Checkbox
                checked={chosenLines.has(i)}
                onChange={(e) => {
                  const next = new Set(chosenLines);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setLines(next);
                }}
                label={
                  <span className="flex flex-wrap gap-2">
                    <span>{l.description}</span>
                    <span className="tabular-nums text-text-secondary">
                      {formatINR(l.rate_paise)} × {l.qty}
                    </span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
        {auto.data.lines.length > 0 && (
          <Button variant="secondary" className="self-start" disabled={addLines.isPending || chosenLines.size === 0} onClick={() => addLines.mutate()}>
            <CirclePlus aria-hidden />
            {t("addCharges", { n: chosenLines.size })}
          </Button>
        )}
      </Card>
    </div>
  );
}
