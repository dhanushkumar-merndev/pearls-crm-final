"use client";

import { Camera, CameraOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Live camera (a document camera or webcam on the reception PC, or a tablet's back
 * camera). Takes full-resolution stills. Where the browser has no camera access
 * (no camera, permission refused, not https) it falls back to the system camera picker.
 */
export function CameraPanel({ onCapture }: { onCapture: (photo: Blob) => void }) {
  const t = useTranslations("scan");
  const video = useRef<HTMLVideoElement>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"starting" | "live" | "unavailable">(() => (typeof navigator.mediaDevices?.getUserMedia === "function" ? "starting" : "unavailable"));
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") return;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((tr) => tr.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
        setState("live");
      })
      .catch(() => !cancelled && setState("unavailable"));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((blob) => blob && onCapture(blob), "image/jpeg", 0.95);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
  };

  return (
    <div className="flex flex-col gap-3">
      {state !== "unavailable" ? (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
          <video ref={video} playsInline muted className="aspect-video w-full object-contain" aria-label={t("cameraView")} />
          {flash && <div aria-hidden className="absolute inset-0 bg-background/60" />}
          {state === "starting" && <p className="absolute inset-0 flex items-center justify-center text-text-secondary">{t("cameraStarting")}</p>}
        </div>
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-secondary p-3">
          <CameraOff aria-hidden className="mt-0.5 size-5 shrink-0 text-status-warning" />
          {t("cameraUnavailable")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {state === "live" ? (
          <Button variant="secondary" size="lg" onClick={capture}>
            <Camera aria-hidden />
            {t("takePhoto")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => fallback.current?.click()}>
            <Camera aria-hidden />
            {t("openCamera")}
          </Button>
        )}
        <input
          ref={fallback}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onCapture(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
