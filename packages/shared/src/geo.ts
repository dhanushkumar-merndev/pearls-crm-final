/**
 * Geo maths shared by the web (BDM map and timeline), the database (geofence, SQL mirror in
 * private.geo_distance_m) and the Android app (track filter). Golden vectors:
 * test-vectors/geo.json. No PostGIS: plain haversine on a sphere is accurate to ~0.5% for
 * the short distances a BDM drives.
 */
export const EARTH_RADIUS_M = 6_371_000;

export type LatLng = readonly [lat: number, lng: number];

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of a path in metres. */
export function pathLengthM(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!);
  return total;
}

/** Inside (or on the edge of) a round geofence. */
export function insideGeofence(center: LatLng, radiusM: number, point: LatLng): boolean {
  return distanceM(center, point) <= radiusM + 1e-6;
}

function encodeValue(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = "";
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

/** Google's encoded polyline (precision 5, ~1 m): how routes travel and are stored. */
export function encodePolyline(points: readonly LatLng[]): string {
  let lat = 0;
  let lng = 0;
  let out = "";
  for (const [a, b] of points) {
    const la = Math.round(a * 1e5);
    const lg = Math.round(b * 1e5);
    out += encodeValue(la - lat) + encodeValue(lg - lng);
    lat = la;
    lng = lg;
  }
  return out;
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      if (i >= encoded.length) throw new Error("bad polyline");
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** "12.4 km" / "850 m" for screens. */
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
