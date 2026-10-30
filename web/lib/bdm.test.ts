import { describe, expect, it } from "vitest";
import { encodePolyline } from "@pearl/shared";
import { bdmTone, minutesSince, trackPoints, type LiveBdm } from "./bdm";

const now = Date.parse("2027-01-15T08:00:00Z");
const bdm = (over: Partial<LiveBdm> = {}): LiveBdm => ({
  staff_id: "s1", name: "Bhavya", state: "travelling", lat: 12.97, lng: 77.59, battery: 60, charging: false, gps_on: true,
  network: "4g", last_heartbeat_at: "2027-01-15T07:57:00Z", locate_requested_at: null,
  day: { id: "d1", started_at: "2027-01-15T04:00:00Z", ended_at: null, flags: [], start_in_geofence: true, route: [] }, ...over,
});

describe("BDM live status", () => {
  it("green while the phone checks in, red after 15 silent minutes, amber with location off", () => {
    expect(bdmTone(bdm(), now)).toBe("good");
    expect(bdmTone(bdm({ last_heartbeat_at: "2027-01-15T07:45:00Z" }), now)).toBe("critical");
    expect(bdmTone(bdm({ last_heartbeat_at: null }), now)).toBe("critical");
    expect(bdmTone(bdm({ gps_on: false }), now)).toBe("warning");
  });
  it("grey when the day hasn't started or has ended", () => {
    expect(bdmTone(bdm({ day: null }), now)).toBe("muted");
    expect(bdmTone(bdm({ day: { ...bdm().day!, ended_at: "2027-01-15T07:00:00Z" } }), now)).toBe("muted");
  });
  it("minutes since a time", () => {
    expect(minutesSince("2027-01-15T07:57:00Z", now)).toBe(3);
    expect(minutesSince(null, now)).toBeNull();
  });
});

describe("route playback", () => {
  it("joins the chunks into one timed list of points", () => {
    const chunks = [
      { started_at: "2027-01-15T04:00:00Z", polyline: encodePolyline([[12.97, 77.59], [12.98, 77.59]]), offsets: [0, 10] },
      { started_at: "2027-01-15T04:05:00Z", polyline: encodePolyline([[12.99, 77.6]]), offsets: [0] },
    ];
    const points = trackPoints(chunks);
    expect(points.map((p) => new Date(p.at).toISOString())).toEqual([
      "2027-01-15T04:00:00.000Z",
      "2027-01-15T04:00:10.000Z",
      "2027-01-15T04:05:00.000Z",
    ]);
    expect(points[2]!.point).toEqual([12.99, 77.6]);
  });
});
