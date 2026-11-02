import { NextResponse, type NextRequest } from "next/server";
import { isMapsUrl, mapsLinkSchema, parseMapsLocation } from "@/lib/maps-link";
import { getMe } from "@/lib/session";

/**
 * Admin → Offices → "Google Maps link": a short link (maps.app.goo.gl/…) only says where the place
 * is after its redirects, which the browser can't follow (CORS). Follows Google Maps redirects only,
 * at most 5, and answers {lat, lng} or {error}.
 */
export async function POST(request: NextRequest) {
  const me = await getMe();
  if (!me || me.role !== "admin") return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  const body = mapsLinkSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  let url = body.data.link;
  for (let hop = 0; hop <= 5; hop++) {
    const found = parseMapsLocation(url);
    if (found) return NextResponse.json(found);
    if (!isMapsUrl(url) || hop === 5) break;
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } });
    } catch {
      return NextResponse.json({ error: "network" }, { status: 502 });
    }
    const next = res.headers.get("location");
    if (!next) break;
    url = new URL(next, url).toString();
  }
  return NextResponse.json({ error: "no_place" }, { status: 422 });
}
