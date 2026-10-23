"use client";

import { Check, Maximize, ScanLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { fullFrame } from "@/lib/scan/detect";
import type { ImagePage } from "@/lib/scan/pages";
import { isConvex, type Point, type Quad } from "@/lib/scan/pixels";
import type { PageSettings } from "@/lib/scan/process";

const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

/**
 * Move the page's four corners by hand when the automatic outline is off: drag a corner
 * (mouse or finger), or focus it and use the arrow keys.
 */
export function PageEditor({ page, onApply }: { page: ImagePage; onApply: (s: PageSettings) => void }) {
  const t = useTranslations("scan");
  const { srcWidth: w, srcHeight: h } = page;
  const [quad, setQuad] = useState<Quad>(() => page.settings.quad ?? page.detected ?? fullFrame(w, h));
  const [unit, setUnit] = useState(1); // photo pixels per screen pixel
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const url = useMemo(() => URL.createObjectURL(page.source), [page.source]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setUnit(w / Math.max(1, el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);

  const move = (i: number, p: Point) => {
    const next = [...quad] as Quad;
    next[i] = { x: Math.min(Math.max(p.x, 0), w), y: Math.min(Math.max(p.y, 0), h) };
    if (isConvex(next)) setQuad(next);
  };
  const toPhoto = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };
  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = Math.max(w, h) * (e.shiftKey ? 0.05 : 0.01);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    move(i, { x: quad[i]!.x + d[0]!, y: quad[i]!.y + d[1]! });
  };
  const r = 22 * unit; // 44 px touch target

  return (
    <DialogContent
      wide
      title={t("adjustTitle")}
      description={t("adjustHint")}
      footer={
        <>
          {page.detected && (
            <Button variant="ghost" onClick={() => setQuad(page.detected!)}>
              <ScanLine aria-hidden />
              {t("adjustDetected")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onApply({ ...page.settings, quad: null })}>
            <Maximize aria-hidden />
            {t("adjustWhole")}
          </Button>
          <Button onClick={() => onApply({ ...page.settings, quad })}>
            <Check aria-hidden />
            {t("adjustApply")}
          </Button>
        </>
      }
    >
      <div className="relative mx-auto w-full max-w-2xl touch-none select-none">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local photo (blob URL), not a site image */}
        <img src={url} alt={t("adjustPhoto")} className="block h-auto w-full rounded-xl" draggable={false} />
        <svg
          ref={svg}
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          onPointerMove={(e) => dragging.current !== null && move(dragging.current, toPhoto(e))}
          onPointerUp={() => (dragging.current = null)}
          onPointerLeave={() => (dragging.current = null)}
        >
          <polygon
            points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
            className="fill-primary/15 stroke-primary"
            strokeWidth={3 * unit}
            vectorEffect="non-scaling-stroke"
          />
          {quad.map((p, i) => (
            <circle
              key={CORNERS[i]}
              cx={p.x}
              cy={p.y}
              r={r}
              tabIndex={0}
              role="slider"
              aria-label={t(`corner.${CORNERS[i]}`)}
              aria-valuetext={`${Math.round((p.x / w) * 100)} %, ${Math.round((p.y / h) * 100)} %`}
              className="cursor-grab fill-primary/40 stroke-primary outline-none focus-visible:fill-ring"
              strokeWidth={3 * unit}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                dragging.current = i;
              }}
              onKeyDown={onKey(i)}
            />
          ))}
        </svg>
      </div>
    </DialogContent>
  );
}
