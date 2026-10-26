// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import { type Deps, orsProvider, type RouteResult, run } from "./logic.ts";

const due = [
  { id: "v1", from: [12.9725, 77.5946], to: [12.9356, 77.6245] },
  { id: "v2", from: [12.9356, 77.6245], to: [12.9716, 77.5946] },
];

function fakeDeps(answers: (RouteResult | Error)[], list: unknown = due) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const asked: unknown[] = [];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: fn === "route_estimates_due" ? list : null, error: null };
    },
    routing: {
      route: async (from, to) => {
        asked.push([from, to]);
        const a = answers.shift()!;
        if (a instanceof Error) throw a;
        return a;
      },
    },
  };
  return { deps, calls, asked };
}
const saves = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === "route_estimate_save").map((c) => c.args);

Deno.test("route-estimate: each reached visit gets km and minutes", async () => {
  const { deps, calls } = fakeDeps([{ ok: true, distanceM: 6123.4, minutes: 17.6 }, { ok: true, distanceM: 5980, minutes: 15.2 }]);
  assertEquals(await run(deps), { state: "done", estimated: 2, failed: 0 });
  assertEquals(saves(calls), [
    { p_id: "v1", p_ok: true, p_distance_m: 6123, p_minutes: 18 },
    { p_id: "v2", p_ok: true, p_distance_m: 5980, p_minutes: 15 },
  ]);
  assertEquals(calls.at(-1), { fn: "ors_integration_state", args: { p_state: "ok", p_error: null } });
});

Deno.test("route-estimate: ORS down → the visit stays pending (saved as a failed try) and the rest go on", async () => {
  const { deps, calls } = fakeDeps([new Error("timeout"), { ok: true, distanceM: 100, minutes: 1 }]);
  assertEquals(await run(deps), { state: "done", estimated: 1, failed: 1 });
  assertEquals(saves(calls)[0], { p_id: "v1", p_ok: false, p_error: "timeout" });
  assertEquals(calls.at(-1)?.args.p_state, "error");
});

Deno.test("route-estimate: a wrong key stops after the first visit", async () => {
  const { deps, asked } = fakeDeps([{ ok: false, error: "ORS: Access to this API has been disallowed", auth: true }]);
  assertEquals((await run(deps)).state, "auth_error");
  assertEquals(asked.length, 1);
});

Deno.test("route-estimate: without an ORS key nothing is asked (estimates stay pending)", async () => {
  const { deps, calls } = fakeDeps([]);
  assertEquals((await run({ ...deps, routing: null })).state, "off");
  assertEquals(calls.length, 0);
});

Deno.test("route-estimate: nothing due → no health update", async () => {
  const { deps, calls } = fakeDeps([], []);
  assertEquals(await run(deps), { state: "done", estimated: 0, failed: 0 });
  assertEquals(calls.map((c) => c.fn), ["route_estimates_due"]);
});

Deno.test("ORS provider: sends [lng, lat] and reads the summary", async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response(JSON.stringify({ routes: [{ summary: { distance: 6123.4, duration: 1056 } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await orsProvider("KEY", fake).route([12.9725, 77.5946], [12.9356, 77.6245]);
  assertEquals(r, { ok: true, distanceM: 6123.4, minutes: 17.6 });
  assertEquals(JSON.parse(String(sent!.init.body)), { coordinates: [[77.5946, 12.9725], [77.6245, 12.9356]] });
  assertEquals((sent!.init.headers as Record<string, string>).Authorization, "KEY");
});

Deno.test("ORS provider: errors are sorted (key problem vs try later)", async () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assertEquals(await orsProvider("K", reply(403, { error: "Access to this API has been disallowed" })).route([0, 0], [1, 1]),
    { ok: false, error: "ORS: Access to this API has been disallowed", auth: true });
  assertEquals((await orsProvider("K", reply(503, { error: { message: "busy" } })).route([0, 0], [1, 1])), { ok: false, error: "ORS: busy", auth: false });
  assertEquals((await orsProvider("K", reply(200, { routes: [] })).route([0, 0], [1, 1])), { ok: false, error: "ORS: no route found", auth: false });
});
