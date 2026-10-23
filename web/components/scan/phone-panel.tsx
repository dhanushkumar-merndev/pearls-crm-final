"use client";

import { CircleCheck, LoaderCircle, RefreshCw, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { rpc } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { viewUrls } from "@/lib/upload";
import { useFeedback } from "@/lib/use-feedback";

export interface PhoneSession {
  sessionId: string;
  token: string;
  expiresAt: string;
}

interface SessionState {
  status: "waiting" | "connected" | "closed" | "expired";
  expires_at: string;
  page_count: number;
  pages: { id: string; page_no: number; file_id: string }[];
}

/**
 * Phone scan (PLAN.md D3): a QR for this patient that works on ONE phone, for 30
 * minutes, until this scan is saved or cancelled. Pages the phone sends appear here
 * live (Realtime), and are added to the pages below.
 */
export function PhonePanel({
  patientId,
  session,
  onSession,
  received,
  onPage,
}: {
  patientId: string;
  session: PhoneSession | null;
  onSession: (s: PhoneSession) => void;
  /** File ids already taken into the pages (so a page is never added twice). */
  received: Set<string>;
  onPage: (photo: Blob, fileId: string) => void;
}) {
  const t = useTranslations("scan");
  const { failed } = useFeedback();
  const [svg, setSvg] = useState("");
  const [state, setState] = useState<SessionState | null>(null);
  const [starting, setStarting] = useState(false);
  const fetching = useRef(new Set<string>());

  const start = useCallback(async () => {
    setStarting(true);
    try {
      if (session) await rpc("close_phone_scan", { p_session_id: session.sessionId }).catch(() => {});
      const s = await rpc<{ session_id: string; token: string; expires_at: string }>("start_phone_scan", { p_patient_id: patientId, p_minutes: 30 });
      setState(null);
      onSession({ sessionId: s.session_id, token: s.token, expiresAt: s.expires_at });
    } catch (e) {
      failed(e);
    } finally {
      setStarting(false);
    }
  }, [failed, onSession, patientId, session]);

  // A code as soon as the panel opens.
  const started = useRef(false);
  useEffect(() => {
    if (!session && !started.current) {
      started.current = true;
      void start();
    }
  }, [session, start]);

  useEffect(() => {
    if (!session) return;
    void QRCode.toString(`${window.location.origin}/scan/${session.token}`, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setSvg);
  }, [session]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const s = await rpc<SessionState>("scan_session_state", { p_session_id: session.sessionId });
      setState(s);
      for (const page of s.pages) {
        if (received.has(page.file_id) || fetching.current.has(page.file_id)) continue;
        fetching.current.add(page.file_id);
        try {
          const url = (await viewUrls([page.file_id]))[page.file_id];
          const res = url ? await fetch(url) : null;
          if (res?.ok) onPage(await res.blob(), page.file_id);
        } finally {
          fetching.current.delete(page.file_id);
        }
      }
    } catch (e) {
      failed(e);
    }
  }, [failed, onPage, received, session]);

  // Live: a new page, or the phone opening the link.
  useEffect(() => {
    if (!session) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`scan:${session.sessionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scan_pages", filter: `session_id=eq.${session.sessionId}` }, () => void refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "scan_sessions", filter: `id=eq.${session.sessionId}` }, () => void refresh())
      // Once listening, catch up on anything that arrived before.
      .subscribe((status) => {
        if (status !== "CLOSED") void refresh(); // also when Realtime is blocked: "Check for pages" then helps
      });
    return () => {
      void supabase.removeChannel(channel);
    };
    // refresh changes with `received`; the subscription only needs the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const status = state?.status ?? "waiting";
  const over = status === "expired" || status === "closed";
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col items-center gap-2 rounded-2xl bg-white p-4 text-black">
        {svg && !over ? (
          // Our own generated SVG (no user input reaches it).
          <div aria-label={t("phoneQrLabel")} role="img" className="size-56" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="size-56 animate-pulse rounded-xl bg-neutral-200" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="flex items-start gap-2">
          <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t("phoneHowTo")}
        </p>
        {status === "waiting" && <StatusBadge kind="warning" label={t("phoneWaiting")} className="self-start" />}
        {status === "connected" && (
          <StatusBadge kind="good" label={t("phoneConnected", { n: state?.page_count ?? 0 })} className="self-start" />
        )}
        {over && <StatusBadge kind="serious" label={t("phoneExpired")} className="self-start" />}
        {session && !over && <p className="text-[0.95rem] text-text-secondary">{t("phoneSingleUse", { time: formatTime(new Date(session.expiresAt)) })}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void start()} disabled={starting}>
            {starting ? <LoaderCircle aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
            {t("phoneNewCode")}
          </Button>
          {!over && (
            <Button variant="ghost" onClick={() => void refresh()}>
              <CircleCheck aria-hidden />
              {t("phoneCheck")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
