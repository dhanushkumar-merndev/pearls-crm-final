"use client";

import { useMutation } from "@tanstack/react-query";
import { CircleCheck, CircleX, Link2, LoaderCircle, PlugZap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { callFunction } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";

type StepKey = "token" | "page" | "leads" | "webhook" | "ads";
interface CheckResult {
  ok?: false;
  error?: string;
  steps?: { key: StepKey; ok: boolean; detail?: string }[];
  can_connect?: boolean;
}

/**
 * Admin → Meta lead ads: asks Meta live whether each step of the connection works
 * (key, page, reading leads, page sending leads, ad account), ✓ or ✗ with Meta's own reason,
 * and offers "Connect page" when only the page's subscription is missing.
 */
export function MetaConnectionCheck() {
  const t = useTranslations("metaCheck");
  const { saved, failed } = useFeedback();
  const check = useMutation({
    mutationFn: () => callFunction<CheckResult>("meta-leads", { action: "check" }),
    onError: failed,
  });
  const connect = useMutation({
    mutationFn: () => callFunction<{ ok: boolean; error?: string }>("meta-leads", { action: "connect" }),
    onSuccess: (r) => {
      if (r.ok) saved(t("connected"));
      check.mutate();
    },
    onError: failed,
  });
  const r = check.data;
  const allGood = !!r?.steps?.length && r.steps.every((s) => s.ok);

  return (
    <div className="flex flex-col gap-3" data-testid="meta-check">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <PlugZap aria-hidden />}
          {t("run")}
        </Button>
        {r?.can_connect && (
          <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Link2 aria-hidden />}
            {t("connect")}
          </Button>
        )}
        {r?.steps && (
          <p role="status" className={allGood ? "font-medium text-status-good" : "font-medium text-bad-text"}>
            {allGood ? t("allGood") : t("notYet")}
          </p>
        )}
      </div>
      {r?.error === "not_configured" && <p className="text-bad-text">{t("notConfigured")}</p>}
      {connect.data && !connect.data.ok && <p className="text-bad-text">{t("connectFailed", { reason: connect.data.error ?? "" })}</p>}
      {r?.steps && (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {r.steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3 px-4 py-2.5">
              {s.ok ? (
                <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-status-good" />
              ) : (
                <CircleX aria-hidden className="mt-0.5 size-5 shrink-0 text-status-critical" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t(`step.${s.key}`)} <span className="sr-only">{s.ok ? t("works") : t("notWorking")}</span>
                </p>
                <p className="text-[0.9rem] break-words text-text-secondary">
                  {s.ok ? okDetail(s, t) : t(`fix.${s.key}`)}
                  {!s.ok && s.detail && s.detail !== "not_subscribed" && s.detail !== "no_ad_account" && (
                    <span className="block">{t("metaSays", { reason: s.detail })}</span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function okDetail(s: { key: StepKey; detail?: string }, t: ReturnType<typeof useTranslations<"metaCheck">>): string {
  if (s.key === "leads") return t("ok.leads", { n: Number(s.detail ?? 0) });
  if (s.key === "webhook") return t("ok.webhook");
  return t(`ok.${s.key}`, { name: s.detail ?? "" });
}
