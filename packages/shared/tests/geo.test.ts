import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/geo.json";
import { decodePolyline, distanceM, encodePolyline, formatDistance, insideGeofence, pathLengthM, type LatLng } from "../src/geo";

const ll = (p: number[]) => [p[0]!, p[1]!] as const;

describe("geo (golden vectors, shared with SQL and Android)", () => {
  it.each(vectors.distance)("distance: $name", ({ a, b, m }) => {
    expect(distanceM(ll(a), ll(b))).toBeCloseTo(m, 0);
  });

  it.each(vectors.geofence)("geofence: $name", ({ office, radius_m, point, inside }) => {
    expect(insideGeofence(ll(office), radius_m, ll(point))).toBe(inside);
  });

  it.each(vectors.polyline)("polyline: $name", ({ points, encoded }) => {
    const pts = points.map(ll);
    expect(encodePolyline(pts)).toBe(encoded);
    decodePolyline(encoded!).forEach((p, i) => {
      expect(p[0]).toBeCloseTo(pts[i]![0], 5);
      expect(p[1]).toBeCloseTo(pts[i]![1], 5);
    });
  });

  it("path length adds the legs; empty and single-point paths are 0", () => {
    const path: LatLng[] = [ll(vectors.distance[1]!.a), ll(vectors.distance[1]!.b), ll(vectors.distance[1]!.a)];
    expect(pathLengthM(path)).toBeCloseTo(2 * vectors.distance[1]!.m, 0);
    expect(pathLengthM([])).toBe(0);
    expect(pathLengthM([ll(vectors.distance[0]!.a)])).toBe(0);
  });

  it("a broken polyline is refused", () => {
    expect(() => decodePolyline("_p~iF~ps|U_")).toThrow();
  });

  it("formats distances for people", () => {
    expect(formatDistance(850.4)).toBe("850 m");
    expect(formatDistance(12_440)).toBe("12.4 km");
  });
});
