"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { Link2, Loader2, LocateFixed, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { STYLE_URL, token } from "@/components/bdm/bdm-map";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { mapsLinkSchema, parseMapsLocation, type LatLngPoint } from "@/lib/maps-link";
import { useZodForm } from "@/lib/use-zod-form";

const INDIA: [number, number] = [77.5946, 12.9716];
const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

/** OpenStreetMap search (Nominatim): free, fair use = one search when the admin asks, never per key press. */
const SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const placesSchema = z.array(z.object({ display_name: z.string(), lat: z.coerce.number(), lon: z.coerce.number() }));
const searchSchema = z.object({ q: z.string().trim().min(3, { error: "officePicker.searchShort" }).max(200, { error: "tooLong" }) });

/** A circle of [radius] metres around a point, as a polygon the map can draw. */
function circle(p: LatLngPoint, radius: number) {
  const ring: [number, number][] = [];
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([p.lng + dLng * Math.cos(a), p.lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } };
}

function pinElement(label: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.title = label;
  Object.assign(el.style, {
    width: "20px",
    height: "20px",
    borderRadius: "9999px",
    background: token("--ring"),
    border: `3px solid ${token("--background")}`,
    boxShadow: "0 0 0 1px rgba(0,0,0,.4)",
    cursor: "grab",
  });
  return el;
}

/**
 * Admin → Offices: where the office is. Search a business / place / address, use this computer's
 * location, paste a Google Maps link, or click / drag on the map. The circle shows "at the office".
 */
export function OfficeLocationPicker({
  lat,
  lng,
  radius,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  radius: number;
  onPick: (p: LatLngPoint) => void;
}) {
  const t = useTranslations("officePicker");
  const mode: keyof typeof STYLE_URL = useTheme().resolvedTheme === "light" ? "light" : "dark";
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const point = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const startPoint = useRef(point);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [busy, setBusy] = useState<"gps" | "search" | "link" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<z.infer<typeof placesSchema> | null>(null);
  const [link, setLink] = useState("");
  const searchForm = useZodForm(searchSchema);
  const linkForm = useZodForm(mapsLinkSchema);

  /** A new point from search / GPS / link: move the pin and the view there. */
  const go = (p: LatLngPoint, acc: number | null = null) => {
    const r = { lat: round7(p.lat), lng: round7(p.lng) };
    setAccuracy(acc);
    pickRef.current(r);
    map.current?.easeTo({ center: [r.lng, r.lat], zoom: Math.max(map.current.getZoom(), 16), duration: 600 });
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !box.current) return;
        maplibre.setWorkerUrl(`${location.origin}/maplibre/maplibre-gl-worker.mjs`);
        lib.current = maplibre;
        const p = startPoint.current;
        const m = new maplibre.Map({
          container: box.current,
          style: STYLE_URL[mode],
          center: p ? [p.lng, p.lat] : INDIA,
          zoom: p ? 16 : 10,
          attributionControl: { compact: true },
        });
        m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        m.on("style.load", () => {
          m.addSource("office-circle", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          m.addLayer({ id: "office-circle-fill", type: "fill", source: "office-circle", paint: { "fill-color": token("--ring"), "fill-opacity": 0.15 } });
          m.addLayer({ id: "office-circle-line", type: "line", source: "office-circle", paint: { "line-color": token("--ring"), "line-width": 2 } });
          if (!cancelled) setReady(true);
        });
        m.on("click", (e) => {
          setAccuracy(null);
          pickRef.current({ lat: round7(e.lngLat.lat), lng: round7(e.lngLat.lng) });
        });
        m.on("error", () => undefined);
        map.current = m;
      } catch {
        if (!cancelled) setMapFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // The map is made once; the style follows the theme at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pin and circle follow the boxes (typed numbers too).
  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre) return;
    const source = m.getSource("office-circle") as GeoJSONSource | undefined;
    if (!point) {
      marker.current?.remove();
      marker.current = null;
      source?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    if (!marker.current) {
      marker.current = new maplibre.Marker({ element: pinElement(t("pin")), draggable: true }).setLngLat([point.lng, point.lat]).addTo(m);
      marker.current.on("dragend", () => {
        const at = marker.current?.getLngLat();
        if (at) {
          setAccuracy(null);
          pickRef.current({ lat: round7(at.lat), lng: round7(at.lng) });
        }
      });
    } else marker.current.setLngLat([point.lng, point.lat]);
    source?.setData(circle(point, radius > 0 ? radius : 0));
  }, [ready, point?.lat, point?.lng, radius, t]); // eslint-disable-line react-hooks/exhaustive-deps

  function locateMe() {
    setNote(null);
    if (!("geolocation" in navigator)) {
      setNote(t("gpsUnavailable"));
      return;
    }
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        go({ lat: pos.coords.latitude, lng: pos.coords.longitude }, Math.round(pos.coords.accuracy));
      },
      (err) => {
        setBusy(null);
        setNote(err.code === err.PERMISSION_DENIED ? t("gpsDenied") : t("gpsUnavailable"));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function search() {
    setNote(null);
    const v = searchForm.validate({ q });
    if (!v) return;
    setBusy("search");
    try {
      const res = await fetch(`${SEARCH_URL}?format=jsonv2&limit=5&q=${encodeURIComponent(v.q)}`, { headers: { "Accept-Language": "en" } });
      const found = placesSchema.safeParse(await res.json());
      setPlaces(found.success ? found.data : []);
    } catch {
      setNote(t("searchFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function applyLink() {
    setNote(null);
    const v = linkForm.validate({ link });
    if (!v) return;
    const local = parseMapsLocation(v.link);
    if (local) {
      go(local);
      return;
    }
    setBusy("link");
    try {
      const res = await fetch("/api/maps-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
      const body = (await res.json()) as Partial<LatLngPoint> & { error?: string };
      if (res.ok && typeof body.lat === "number" && typeof body.lng === "number") go({ lat: body.lat, lng: body.lng });
      else linkForm.setError("link", "officePicker.linkNoPlace");
    } catch {
      setNote(t("searchFailed"));
    } finally {
      setBusy(null);
    }
  }

  const enter = (fn: () => void) => (e: React.KeyboardEvent) => {
    // The picker sits inside the office form: Enter searches instead of saving.
    if (e.key === "Enter") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={locateMe} disabled={busy !== null}>
          {busy === "gps" ? <Loader2 aria-hidden className="animate-spin" /> : <LocateFixed aria-hidden />}
          {t("useMyLocation")}
        </Button>
        <span className="text-[0.9rem] text-text-secondary">{t("useMyLocationHint")}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("search")} hint={t("searchHint")} error={searchForm.error("q")}>
          {(a) => (
            <div className="flex gap-2">
              <Input
                {...a}
                value={q}
                placeholder={t("searchPlaceholder")}
                onChange={(e) => {
                  setQ(e.target.value);
                  searchForm.clear("q");
                }}
                onKeyDown={enter(() => void search())}
              />
              <Button type="button" variant="secondary" onClick={() => void search()} disabled={busy !== null} aria-label={t("searchButton")}>
                {busy === "search" ? <Loader2 aria-hidden className="animate-spin" /> : <Search aria-hidden />}
                {t("searchButton")}
              </Button>
            </div>
          )}
        </Field>
        <Field label={t("link")} hint={t("linkHint")} error={linkForm.error("link")}>
          {(a) => (
            <div className="flex gap-2">
              <Input
                {...a}
                value={link}
                placeholder="https://maps.app.goo.gl/…"
                onChange={(e) => {
                  setLink(e.target.value);
                  linkForm.clear("link");
                }}
                onKeyDown={enter(() => void applyLink())}
              />
              <Button type="button" variant="secondary" onClick={() => void applyLink()} disabled={busy !== null}>
                {busy === "link" ? <Loader2 aria-hidden className="animate-spin" /> : <Link2 aria-hidden />}
                {t("useLink")}
              </Button>
            </div>
          )}
        </Field>
      </div>
      {places !== null && (
        <div role="region" aria-label={t("results")} className="flex flex-col gap-1 rounded-lg border border-border p-1">
          {places.length === 0 ? (
            <p className="p-2 text-text-secondary">{t("noResults")}</p>
          ) : (
            places.map((p, i) => (
              <button
                key={`${p.lat},${p.lon},${i}`}
                type="button"
                className="rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => {
                  setPlaces(null);
                  go({ lat: p.lat, lng: p.lon });
                }}
              >
                {p.display_name}
              </button>
            ))
          )}
        </div>
      )}
      {note && (
        <p role="status" className="text-[0.9rem] text-bad-text">
          {note}
        </p>
      )}
      <div className="relative overflow-hidden rounded-xl border border-border">
        <div ref={box} role="region" aria-label={t("map")} className="h-72 w-full" />
        {mapFailed && <p className="absolute inset-0 grid place-items-center p-4 text-center text-text-secondary">{t("mapFailed")}</p>}
      </div>
      <p className="text-[0.9rem] text-text-secondary" data-testid="office-pin">
        {point
          ? t("pinAt", { lat: point.lat.toFixed(6), lng: point.lng.toFixed(6), radius }) + (accuracy !== null ? ` · ${t("accuracy", { m: accuracy })}` : "")
          : t("noPin")}
      </p>
    </div>
  );
}
