import { z } from "zod";

export interface LatLngPoint {
  lat: number;
  lng: number;
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

function point(lat: string | undefined, lng: string | undefined): LatLngPoint | null {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

/**
 * The place a Google Maps address points at. The pin (`!3d…!4d…`) comes first: the `@lat,lng`
 * part is only where the map view is centred. Also takes `?q=lat,lng` links and plain "12.93, 77.55".
 */
export function parseMapsLocation(text: string): LatLngPoint | null {
  const s = decodeURIComponent(text.trim().replace(/\+/g, " "));
  const pin = new RegExp(String.raw`!3d${NUM}!4d${NUM}`).exec(s);
  if (pin) return point(pin[1], pin[2]);
  const query = new RegExp(String.raw`[?&](?:q|query|ll|destination|center)=(?:loc:)?${NUM},\s*${NUM}`).exec(s);
  if (query) return point(query[1], query[2]);
  const at = new RegExp(String.raw`@${NUM},${NUM}`).exec(s);
  if (at) return point(at[1], at[2]);
  const plain = new RegExp(String.raw`^${NUM}\s*,\s*${NUM}$`).exec(s);
  if (plain) return point(plain[1], plain[2]);
  return null;
}

/** Only Google Maps addresses (and its short links) are followed by the server. */
export function isMapsHost(host: string): boolean {
  return /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?)$/i.test(host);
}

export function isMapsUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === "https:" && isMapsHost(u.hostname);
  } catch {
    return false;
  }
}

/** The "Google Maps link" box: a Google Maps https link, or "lat, lng". Messages are en.json keys. */
export const mapsLinkSchema = z.object({
  link: z
    .string()
    .trim()
    .min(1, { error: "required" })
    .max(2000, { error: "officePicker.linkInvalid" })
    .refine((v) => isMapsUrl(v) || parseMapsLocation(v) !== null, { error: "officePicker.linkInvalid" }),
});
