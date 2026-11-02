import { describe, expect, it } from "vitest";
import { isMapsHost, isMapsUrl, mapsLinkSchema, parseMapsLocation } from "./maps-link";

describe("parseMapsLocation", () => {
  it("takes the pin, not the centre of the map view", () => {
    const url =
      "https://www.google.com/maps/place/Star+Tech+India/@12.9302942,77.5520256,15z/data=!4m7!3m6!1s0x3bae3f488e071c6d:0xb0bf8fc1e00fe2e6!8m2!3d12.9373626!4d77.5582325!15sCg9z";
    expect(parseMapsLocation(url)).toEqual({ lat: 12.9373626, lng: 77.5582325 });
  });
  it("falls back to ?q=lat,lng, then @lat,lng, then plain numbers", () => {
    expect(parseMapsLocation("https://maps.google.com/?q=12.97,77.59")).toEqual({ lat: 12.97, lng: 77.59 });
    expect(parseMapsLocation("https://www.google.com/maps/@12.5,-77.25,17z")).toEqual({ lat: 12.5, lng: -77.25 });
    expect(parseMapsLocation(" 12.9716, 77.5946 ")).toEqual({ lat: 12.9716, lng: 77.5946 });
  });
  it("refuses what isn't a place", () => {
    expect(parseMapsLocation("https://maps.app.goo.gl/vZtNcnvLDDjqwjj67")).toBeNull();
    expect(parseMapsLocation("95.1, 77.2")).toBeNull();
    expect(parseMapsLocation("Star Tech India")).toBeNull();
  });
});

describe("which links the server follows", () => {
  it("only Google Maps over https", () => {
    expect(isMapsHost("maps.app.goo.gl")).toBe(true);
    expect(isMapsHost("www.google.co.in")).toBe(true);
    expect(isMapsHost("google.com.evil.example")).toBe(false);
    expect(isMapsUrl("https://maps.app.goo.gl/abc")).toBe(true);
    expect(isMapsUrl("http://maps.app.goo.gl/abc")).toBe(false);
    expect(isMapsUrl("https://example.com/maps")).toBe(false);
  });
  it("the link box needs a Google Maps link or numbers", () => {
    expect(mapsLinkSchema.safeParse({ link: "" }).error?.issues[0]?.message).toBe("required");
    expect(mapsLinkSchema.safeParse({ link: "https://example.com" }).error?.issues[0]?.message).toBe("officePicker.linkInvalid");
    expect(mapsLinkSchema.safeParse({ link: "https://maps.app.goo.gl/vZtNcnvLDDjqwjj67" }).success).toBe(true);
  });
});
