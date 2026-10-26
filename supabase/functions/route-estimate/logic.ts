// route-estimate: how far a BDM should have driven for each visit (OpenRouteService), so the
// timeline can show km driven next to km expected (PLAN.md D2). Called every 10 minutes by the
// database timer and right after a visit is reached. When ORS is down or not set up, visits
// stay "estimate pending" and are retried later with a growing wait (5 tries).
// Pure logic here; index.ts wires the real ORS and database.
import { z } from "zod";

export const requestSchema = z.object({}).passthrough();

export interface Due {
  id: string;
  from: [number, number];
  to: [number, number];
}

export type RouteResult = { ok: true; distanceM: number; minutes: number } | { ok: false; error: string; auth: boolean };

/** A routing service (OpenRouteService; swappable). Points are [lat, lng]. */
export interface RoutingProvider {
  route(from: [number, number], to: [number, number]): Promise<RouteResult>;
}

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  routing: RoutingProvider | null;
}

const dueSchema = z.array(z.object({
  id: z.string(),
  from: z.tuple([z.number(), z.number()]),
  to: z.tuple([z.number(), z.number()]),
}));

export interface Result {
  state: "off" | "done" | "auth_error";
  estimated: number;
  failed: number;
}

export async function run(deps: Deps): Promise<Result> {
  const result: Result = { state: "done", estimated: 0, failed: 0 };
  if (!deps.routing) return { ...result, state: "off" };
  const { data, error } = await deps.rpc("route_estimates_due", { p_limit: 20 });
  if (error) throw new Error(error.message);
  const due = dueSchema.safeParse(data);
  if (!due.success) throw new Error("bad route_estimates_due answer");
  let lastError: string | null = null;
  for (const v of due.data) {
    let r: RouteResult;
    try {
      r = await deps.routing.route(v.from, v.to);
    } catch (e) {
      r = { ok: false, error: (e as Error).message, auth: false };
    }
    if (r.ok) {
      await deps.rpc("route_estimate_save", { p_id: v.id, p_ok: true, p_distance_m: Math.round(r.distanceM), p_minutes: Math.round(r.minutes) });
      result.estimated++;
    } else {
      await deps.rpc("route_estimate_save", { p_id: v.id, p_ok: false, p_error: r.error.slice(0, 500) });
      result.failed++;
      lastError = r.error;
      // A wrong key fails every request the same way: stop and say so.
      if (r.auth) {
        result.state = "auth_error";
        break;
      }
    }
  }
  if (due.data.length > 0) {
    await deps.rpc("ors_integration_state", { p_state: result.failed === 0 ? "ok" : "error", p_error: lastError });
  }
  return result;
}

const orsSchema = z.object({
  routes: z.array(z.object({ summary: z.object({ distance: z.number().default(0), duration: z.number().default(0) }) })).min(1),
});

/** ORS directions (driving-car). https://openrouteservice.org/dev/#/api-docs/v2/directions */
export function orsProvider(apiKey: string, fetcher: typeof fetch = fetch): RoutingProvider {
  return {
    async route(from, to) {
      const res = await fetcher("https://api.openrouteservice.org/v2/directions/driving-car", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/json" },
        // ORS wants [lng, lat].
        body: JSON.stringify({ coordinates: [[from[1], from[0]], [to[1], to[0]]] }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (body as { error?: { message?: string } | string } | null)?.error;
        const text = typeof message === "string" ? message : message?.message ?? `HTTP ${res.status}`;
        return { ok: false, error: `ORS: ${text}`, auth: res.status === 401 || res.status === 403 };
      }
      const parsed = orsSchema.safeParse(body);
      if (!parsed.success) return { ok: false, error: "ORS: no route found", auth: false };
      const s = parsed.data.routes[0]!.summary;
      return { ok: true, distanceM: s.distance, minutes: s.duration / 60 };
    },
  };
}
