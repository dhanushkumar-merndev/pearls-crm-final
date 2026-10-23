"use client";

import { Camera, CircleCheck, Contrast, ImagePlus, LoaderCircle, RotateCw, Send, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { bestImageMime, compressImage, decodeImage, detectInBackground, encodeImage, processInBackground, warmUp } from "@/lib/scan/browser";
import { SCAN } from "@/lib/scan/config";
import type { Pixels } from "@/lib/scan/pixels";
import type { PageSettings } from "@/lib/scan/process";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/upload";

/** Never throws: no network, a server error or a bad answer all come back as { error }. */
async function call<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data, error } = await getSupabaseBrowser().functions.invoke("phone-scan", { body });
    if (!error) return { data: data as T, error: null };
    const res = (error as { context?: unknown }).context;
    const payload = res instanceof Response ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    return { data: null, error: payload?.error ?? "unknown" };
  } catch {
    return { data: null, error: "unknown" };
  }
}

/** This phone's own secret for this link (the link works only on the phone that opened it first). */
function deviceKey(token: string): string {
  const key = `pearl.scan.${token.slice(0, 16)}`;
  const make = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const fresh = make();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return make(); // storage blocked: works until the page is reloaded
  }
}

interface Pending {
  source: Pixels;
  settings: PageSettings;
  preview: string;
  out: Pixels;
}

type Screen = "loading" | "ready" | "expired" | "used" | "error" | "done";

export function PhoneScan({ token }: { token: string }) {
  const t = useTranslations("scanPhone");
  const e = useTranslations("errors");
  const [screen, setScreen] = useState<Screen>("loading");
  const [info, setInfo] = useState<{ clinic: string | null; uhid: string | null; max_pages: number } | null>(null);
  const [sent, setSent] = useState(0);
  const waiting = useRef<File[]>([]);
  const [page, setPage] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<"preparing" | "sending" | null>(null);
  const [message, setMessage] = useState<{ kind: "good" | "critical"; text: string } | null>(null);
  const [key] = useState(() => deviceKey(token));
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const fail = (code: string | null) => {
    if (code === "link_expired") setScreen("expired");
    else if (code === "link_used") setScreen("used");
    else setMessage({ kind: "critical", text: e(code && e.has(code) ? code : "unknown") });
  };

  useEffect(() => {
    warmUp();
    void call<{ page_count: number; max_pages: number; uhid: string | null; clinic: string | null }>({ action: "open", token, device_key: key }).then(
      ({ data, error }) => {
        if (!data) return error === "link_expired" ? setScreen("expired") : error === "link_used" ? setScreen("used") : setScreen("error");
        setInfo({ clinic: data.clinic, uhid: data.uhid, max_pages: data.max_pages });
        setSent(data.page_count);
        setScreen("ready");
      },
    );
  }, [token, key]);

  const show = async (source: Pixels, settings: PageSettings) => {
    const out = await processInBackground(source, settings);
    const preview = URL.createObjectURL(await encodeImage(out, "image/jpeg", 0.85));
    setPage((old) => {
      if (old) URL.revokeObjectURL(old.preview);
      return { source, settings, preview, out };
    });
  };

  /** The next photo in line: find the page, straighten it, document mode on. */
  const prepareNext = async () => {
    const file = waiting.current.shift();
    if (!file) return;
    setBusy("preparing");
    setMessage(null);
    try {
      const source = await decodeImage(file);
      const quad = await detectInBackground(source);
      await show(source, { quad, rotation: 0, mode: "document" });
    } catch (err) {
      setMessage({ kind: "critical", text: e(err instanceof Error && e.has(err.message) ? err.message : "file_unreadable") });
      setBusy(null);
      return prepareNext();
    }
    setBusy(null);
  };

  const adjust = async (settings: PageSettings) => {
    if (!page) return;
    setBusy("preparing");
    try {
      await show(page.source, settings);
    } finally {
      setBusy(null);
    }
  };

  /** Compress → upload slot → straight to storage → server checks the bytes → page number. */
  const upload = async (p: Pending): Promise<boolean> => {
    const mime = await bestImageMime();
    const fitted = await compressImage(p.out, SCAN.pageTargetBytes, mime);
    const put = await call<{ file_id: string; status: string; upload?: { url: string; headers: Record<string, string> } }>({
      action: "put", token, device_key: key, mime, size: fitted.size, sha256: await sha256Hex(fitted.out), client_id: crypto.randomUUID(),
    });
    if (!put.data) return (fail(put.error), false);
    if (put.data.upload) {
      const res = await fetch(put.data.upload.url, { method: "PUT", headers: put.data.upload.headers, body: fitted.out }).catch(() => null);
      if (!res?.ok) return (fail("upload_incomplete"), false);
    }
    const done = await call<{ page_no: number; page_count: number }>({
      action: "confirm", token, device_key: key, file_id: put.data.file_id, width: fitted.width, height: fitted.height,
    });
    if (!done.data) return (fail(done.error), false);
    setSent(done.data.page_count);
    setMessage({ kind: "good", text: t("sentPage", { n: done.data.page_no }) });
    return true;
  };

  const send = async () => {
    if (!page) return;
    setBusy("sending");
    setMessage(null);
    let ok = false;
    try {
      ok = await upload(page);
    } catch (err) {
      fail(err instanceof Error ? err.message : null);
    } finally {
      setBusy(null);
    }
    if (!ok) return;
    URL.revokeObjectURL(page.preview);
    setPage(null);
    void prepareNext();
  };

  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    waiting.current.push(...files);
    if (!page && busy === null) void prepareNext();
  };

  if (screen === "loading")
    return (
      <p className="flex items-center gap-2 text-text-secondary">
        <LoaderCircle aria-hidden className="size-5 animate-spin" />
        {t("loading")}
      </p>
    );
  if (screen !== "ready" && screen !== "done")
    return (
      <Card>
        <h1 className="text-xl font-semibold">{t(`${screen}Title`)}</h1>
        <p className="mt-2 text-text-secondary">{t("askReception")}</p>
      </Card>
    );
  if (screen === "done")
    return (
      <Card className="flex flex-col items-center gap-3 py-10 text-center">
        <CircleCheck aria-hidden className="size-12 text-status-good" />
        <h1 className="text-2xl font-semibold">{t("doneTitle", { n: sent })}</h1>
        <p className="text-text-secondary">{t("doneBody")}</p>
      </Card>
    );

  const full = sent >= (info?.max_pages ?? SCAN.maxPages);
  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-text-secondary">{[info?.clinic, info?.uhid].filter(Boolean).join(" · ")}</p>
      </header>
      <StatusBadge kind={sent > 0 ? "good" : "warning"} label={t("sentCount", { n: sent })} className="self-start" />

      {page ? (
        <Card className="flex flex-col gap-3 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL) */}
          <img src={page.preview} alt={t("previewAlt")} className="max-h-[60dvh] w-full rounded-xl object-contain" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy !== null} onClick={() => void adjust({ ...page.settings, rotation: (page.settings.rotation + 1) % 4 })}>
              <RotateCw aria-hidden />
              {t("rotate")}
            </Button>
            <Button
              variant="secondary"
              aria-pressed={page.settings.mode === "document"}
              disabled={busy !== null}
              onClick={() => void adjust({ ...page.settings, mode: page.settings.mode === "document" ? "colour" : "document" })}
            >
              <Contrast aria-hidden />
              {page.settings.mode === "document" ? t("colour") : t("documentMode")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void adjust({ ...page.settings, quad: null })}
            >
              <ImagePlus aria-hidden />
              {t("wholePhoto")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                URL.revokeObjectURL(page.preview);
                setPage(null);
                void prepareNext();
              }}
            >
              <Undo2 aria-hidden />
              {t("retake")}
            </Button>
          </div>
          <Button size="lg" disabled={busy !== null} onClick={() => void send()}>
            {busy === "sending" ? <LoaderCircle aria-hidden className="animate-spin" /> : <Send aria-hidden />}
            {busy === "sending" ? t("sending") : t("send")}
          </Button>
        </Card>
      ) : busy === "preparing" ? (
        <p className="flex items-center gap-2 text-text-secondary">
          <LoaderCircle aria-hidden className="size-5 animate-spin" />
          {t("preparing")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Button size="lg" disabled={full} onClick={() => camera.current?.click()}>
            <Camera aria-hidden />
            {sent === 0 ? t("takeFirst") : t("takeNext")}
          </Button>
          <Button variant="secondary" disabled={full} onClick={() => gallery.current?.click()}>
            <ImagePlus aria-hidden />
            {t("fromGallery")}
          </Button>
          {sent > 0 && (
            <Button variant="ghost" onClick={() => setScreen("done")}>
              <CircleCheck aria-hidden />
              {t("finished")}
            </Button>
          )}
          {full && <p className="text-text-secondary">{t("full")}</p>}
        </div>
      )}
      {message && (
        <p role={message.kind === "critical" ? "alert" : "status"} className={message.kind === "critical" ? "text-bad-text" : "text-good-text"}>
          {message.text}
        </p>
      )}
      <p className="text-[0.95rem] text-text-secondary">{t("privacy")}</p>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(ev) => (pick(ev.target.files), (ev.target.value = ""))} />
      <input ref={gallery} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(ev) => (pick(ev.target.files), (ev.target.value = ""))} />
    </>
  );
}
