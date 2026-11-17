"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, Check, Send, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { currentPushState, type PushState, turnOffPush, turnOnPush } from "@/lib/push/web-push";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";

const noSubscribe = () => () => {};

/** This browser's pop-up state (null while the page is drawn on the server); the setter overrides it after an action. */
export function usePushState(): [PushState | null, (s: PushState) => void] {
  const fromBrowser = useSyncExternalStore(noSubscribe, currentPushState, () => null);
  const [changed, setChanged] = useState<PushState | null>(null);
  return [changed ?? fromBrowser, setChanged];
}

/**
 * "Pop-ups on this computer" (Phase 20a): turn on / off for the signed-in person in this browser, and
 * send oneself a test. Hidden when the clinic hasn't set up the Firebase web keys.
 */
export function PushCard() {
  const t = useTranslations("pushNotify");
  const { saved, failed } = useFeedback();
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  if (state === null || state === "off") return null;

  async function act(fn: () => Promise<PushState | void>, done?: string) {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setState(next);
      if (done) saved(done);
    } catch (e) {
      // The server's answers (e.g. "too many tries") are plain objects with a code; a browser or Firebase
      // problem is an Error.
      if (e instanceof Error) toast.error(t("turnOnFailed"));
      else failed(e);
      setState(currentPushState());
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    const { error } = await getSupabaseBrowser().rpc("push_test");
    if (error) throw error;
    // The test is in the list and the bell right away (this page doesn't listen live).
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <Card
      className="flex flex-col gap-3"
      aria-labelledby="push-card-title"
      data-testid="push-card"
      data-state={state}
    >
      <div>
        <CardTitle id="push-card-title">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </div>
      <p role="status" className="flex items-center gap-2">
        {state === "on" ? (
          <Check aria-hidden className="size-4 text-good-text" />
        ) : state === "blocked" || state === "unsupported" ? (
          <ShieldAlert aria-hidden className="size-4 text-text-secondary" />
        ) : (
          <BellOff aria-hidden className="size-4 text-text-secondary" />
        )}
        <span>{t(`state.${state}`)}</span>
      </p>
      {state === "blocked" && <p className="max-w-prose text-text-secondary">{t("blockedHelp")}</p>}
      {state === "unsupported" && (
        <p className="max-w-prose text-text-secondary">{t("unsupportedHelp")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {state === "ask" && (
          <Button disabled={busy} onClick={() => void act(turnOnPush)}>
            <BellRing aria-hidden />
            {busy ? t("turningOn") : t("turnOn")}
          </Button>
        )}
        {state === "on" && (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void act(sendTest, t("testSent"))}
            >
              <Send aria-hidden />
              {t("sendTest")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void act(turnOffPush, t("turnedOff"))}
            >
              <BellOff aria-hidden />
              {t("turnOff")}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
