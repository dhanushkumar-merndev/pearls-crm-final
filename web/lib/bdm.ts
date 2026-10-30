// BDM screens' plain logic (tested in lib/bdm.test.ts).
import { decodePolyline, type LatLng } from "@pearl/shared";

/** How a BDM shows on the map and in the list. */
export type BdmTone = "good" | "warning" | "critical" | "muted";

export interface LiveBdm {
  staff_id: string;
  name: string;
  state: "off_duty" | "in_office" | "travelling" | "at_visit" | "on_break";
  lat: number | null;
  lng: number | null;
  battery: number | null;
  charging: boolean | null;
  gps_on: boolean | null;
  network: string | null;
  last_heartbeat_at: string | null;
  locate_requested_at: string | null;
  day: {
    id: string;
    started_at: string;
    ended_at: string | null;
    flags: string[];
    start_in_geofence: boolean | null;
    /** Today's uploaded route pieces (encoded polylines), in order. */
    route: string[];
  } | null;
}

/** Silent longer than this (the watchdog's default) shows as a problem. */
const SILENT_MINUTES = 15;

export function minutesSince(at: string | null, now: number): number | null {
  return at ? Math.floor((now - new Date(at).getTime()) / 60_000) : null;
}

/** Map dot and list badge for one BDM. */
export function bdmTone(b: LiveBdm, now: number): BdmTone {
  const open = b.day && !b.day.ended_at;
  if (!open) return "muted";
  const silent = minutesSince(b.last_heartbeat_at, now);
  if (silent === null || silent >= SILENT_MINUTES) return "critical";
  if (b.gps_on === false) return "warning";
  return "good";
}

/** A recorded point for playback: where the BDM was at a moment. */
export interface TrackPoint {
  at: number;
  point: LatLng;
}

/** All chunks → one time-ordered list of points (for the map line and playback). */
export function trackPoints(chunks: { started_at: string; polyline: string; offsets: number[] }[]): TrackPoint[] {
  return chunks.flatMap((c) => {
    const start = new Date(c.started_at).getTime();
    return decodePolyline(c.polyline).map((point, i) => ({ at: start + (c.offsets[i] ?? 0) * 1000, point }));
  });
}

