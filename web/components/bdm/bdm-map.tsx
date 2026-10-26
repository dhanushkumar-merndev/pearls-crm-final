"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@pearl/shared";
import { cn } from "@/lib/utils";

/** OpenFreeMap: free tiles, business use allowed (PLAN.md A2 "Maps"). */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const INDIA: [number, number] = [77.5946, 12.9716];

export type MarkerTone = "good" | "warning" | "critical" | "muted";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  tone: MarkerTone;
}

export interface MapPath {
  id: string;
  points: LatLng[];
}

const TONE_VAR: Record<MarkerTone, string> = {
  good: "--status-good",
  warning: "--status-warning",
  critical: "--status-critical",
  muted: "--muted-foreground",
};

/** A colour token's current value (the map draws on a canvas, so it needs the real colour). */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "gray";
}

function dot(tone: MarkerTone, label: string, big = false): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.title = label;
  const size = big ? 18 : 14;
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "9999px",
    background: token(TONE_VAR[tone]),
    border: `2px solid ${token("--background")}`,
    boxShadow: "0 0 0 1px rgba(0,0,0,.35)",
  });
  return el;
}

/**
 * MapLibre map (loaded only on BDM pages). Markers for people/places, lines for routes, and an
 * optional moving dot for route playback. The page always lists the same data as text too.
 */
export function BdmMap({
  markers = [],
  paths = [],
  cursor = null,
  className,
  label,
}: {
  markers?: MapMarker[];
  paths?: MapPath[];
  cursor?: LatLng | null;
  className?: string;
  label: string;
}) {
  const t = useTranslations("bdm");
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const placed = useRef<Marker[]>([]);
  const cursorMarker = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !box.current) return;
        lib.current = maplibre;
        const m = new maplibre.Map({ container: box.current, style: STYLE_URL, center: INDIA, zoom: 10, attributionControl: { compact: true } });
        m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        m.on("load", () => {
          m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          m.addLayer({
            id: "routes",
            type: "line",
            source: "routes",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": token("--chart-1"), "line-width": 4 },
          });
          if (!cancelled) setReady(true);
        });
        m.on("error", () => undefined);
        map.current = m;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre) return;
    placed.current.forEach((p) => p.remove());
    placed.current = markers.map((mk) => new maplibre.Marker({ element: dot(mk.tone, mk.label) }).setLngLat([mk.lng, mk.lat]).addTo(m));
    const source = m.getSource("routes") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: paths
        .filter((p) => p.points.length > 1)
        .map((p) => ({ type: "Feature", properties: { id: p.id }, geometry: { type: "LineString", coordinates: p.points.map(([la, lg]) => [lg, la]) } })),
    });
    // Frame everything once (later updates keep the person's own zoom).
    const all: [number, number][] = [...markers.map((mk) => [mk.lng, mk.lat] as [number, number]), ...paths.flatMap((p) => p.points.map(([la, lg]) => [lg, la] as [number, number]))];
    if (!fitted.current && all.length > 0) {
      const bounds = all.reduce((b, c) => b.extend(c), new maplibre.LngLatBounds(all[0], all[0]));
      m.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
      fitted.current = true;
    }
  }, [ready, markers, paths]);

  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre) return;
    if (!cursor) {
      cursorMarker.current?.remove();
      cursorMarker.current = null;
      return;
    }
    if (!cursorMarker.current) cursorMarker.current = new maplibre.Marker({ element: dot("warning", t("playbackPosition"), true) }).setLngLat([cursor[1], cursor[0]]).addTo(m);
    else cursorMarker.current.setLngLat([cursor[1], cursor[0]]);
  }, [ready, cursor, t]);

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border", className)}>
      <div ref={box} role="region" aria-label={label} className="size-full min-h-80" />
      {failed && <p className="absolute inset-0 grid place-items-center p-4 text-center text-text-secondary">{t("mapFailed")}</p>}
    </div>
  );
}
