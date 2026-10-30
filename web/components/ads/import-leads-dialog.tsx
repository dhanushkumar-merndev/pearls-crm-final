"use client";

import { useMutation } from "@tanstack/react-query";
import { Download, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { callFunction } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

const DAYS = ["7", "30", "90"] as const;
const importSchema = z.object({ days: z.enum(DAYS, { error: "required" }) });

interface Round {
  ok?: false;
  forms: number;
  seen: number;
  created: number;
  duplicate: number;
  failed: number;
  already: number;
  done: boolean;
  error?: string;
}
type Totals = Omit<Round, "ok" | "done" | "error" | "forms">;

/** At most this many rounds of ~100 s each (a very big backlog says so and can be run again). */
const MAX_ROUNDS = 10;

/**
 * "Import past leads": pulls the lead forms' leads from Meta for the last 7/30/90 days, quietly
 * (no alert per lead, no WhatsApp welcome; each owner gets one summary alert). Numbers already in
 * the CRM are linked, not added again; running it twice adds nothing twice.
 */
export function ImportLeadsDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("ads.import");
  const [days, setDays] = useState<string>("30");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [result, setResult] = useState<{ done: boolean; error?: string } | null>(null);
  const checks = useZodForm(importSchema);
  const { errorMessage } = useFeedback();
  const run = useMutation({
    mutationFn: async (n: number) => {
      const sum: Totals = { seen: 0, created: 0, duplicate: 0, failed: 0, already: 0 };
      setTotals(sum);
      for (let i = 0; i < MAX_ROUNDS; i++) {
        const r = await callFunction<Round>("meta-leads", { action: "import", days: n });
        for (const k of Object.keys(sum) as (keyof Totals)[]) sum[k] += r[k] ?? 0;
        setTotals({ ...sum });
        if (r.error || r.ok === false || r.done) return { done: !!r.done, error: r.error };
      }
      return { done: false };
    },
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
    onError: (e) => setResult({ done: false, error: errorMessage(e) }),
  });
  const start = () => {
    const v = checks.validate({ days });
    if (v) {
      setResult(null);
      run.mutate(Number(v.days));
    }
  };

  return (
    <DialogContent
      title={t("title")}
      description={t("hint")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">{result ? t("close") : t("cancel")}</Button>
          </DialogClose>
          <Button disabled={run.isPending} onClick={start}>
            {run.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
            {run.isPending ? t("running") : t("start")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("days")} error={checks.error("days")}>
          {(a) => (
            <Select
              {...a}
              value={days}
              disabled={run.isPending}
              onChange={(e) => (setDays(e.target.value), checks.clear("days"))}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {t("lastDays", { n: d })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ul className="list-disc pl-5 text-[0.95rem] text-text-secondary">
          <li>{t("quiet")}</li>
          <li>{t("sameNumber")}</li>
          <li>{t("again")}</li>
        </ul>
        {totals && (
          <p role="status" className="tabular-nums" data-testid="import-progress">
            {t("progress", { ...totals })}
          </p>
        )}
        {result?.done && <p className="font-medium text-status-good">{t("finished")}</p>}
        {result && !result.done && !result.error && <p className="text-bad-text">{t("notFinished")}</p>}
        {result?.error && <p className="text-bad-text">{t("failed", { reason: result.error })}</p>}
      </div>
    </DialogContent>
  );
}
