// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import { publicForm, type Deps } from "./logic.ts";

const TOKEN = "a".repeat(48);
const payload = { full_name: "Self Reg", phone_e164: "+919811122233" };

function fakeDeps(opts: { turnstile?: boolean; rpc?: Record<string, { data?: unknown; error?: string }> } = {}) {
  const calls: string[] = [];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push(`${fn} ${JSON.stringify(args)}`);
      const r = opts.rpc?.[fn] ?? { data: { valid: true } };
      return { data: (r.data ?? null) as never, error: r.error ? { message: r.error } : null };
    },
    verifyTurnstile: async () => opts.turnstile ?? true,
    hashIp: async (ip) => `hash(${ip})`,
  };
  return { deps, calls };
}

Deno.test("info: a valid link returns the form", async () => {
  const { deps } = fakeDeps({ rpc: { public_form_info: { data: { valid: true, clinic: { name: "Demo" } } } } });
  const res = await publicForm({ action: "info", token: TOKEN }, null, deps);
  assertEquals(res.status, 200);
  assertEquals(res.body.clinic, { name: "Demo" });
});

Deno.test("info: an expired or unknown link says so", async () => {
  const { deps } = fakeDeps({ rpc: { public_form_info: { data: { valid: false } } } });
  assertEquals(await publicForm({ action: "info", token: TOKEN }, null, deps), { status: 410, body: { error: "link_expired" } });
});

Deno.test("submit: a failed bot check stops before the database", async () => {
  const { deps, calls } = fakeDeps({ turnstile: false });
  const res = await publicForm({ action: "submit", token: TOKEN, turnstile_token: "x", payload }, "1.2.3.4", deps);
  assertEquals(res, { status: 403, body: { error: "bot_check_failed" } });
  assertEquals(calls, []);
});

Deno.test("submit: stores the hashed IP, never the IP itself", async () => {
  const { deps, calls } = fakeDeps({ rpc: { public_form_submit: {} } });
  const res = await publicForm({ action: "submit", token: TOKEN, turnstile_token: "x", payload }, "1.2.3.4", deps);
  assertEquals(res.status, 200);
  assertEquals(calls[0]!.includes('"p_ip_hash":"hash(1.2.3.4)"'), true);
  assertEquals(calls[0]!.includes("1.2.3.4\""), false);
});

Deno.test("submit: fields a patient may not set are dropped", async () => {
  const { deps, calls } = fakeDeps({ rpc: { public_form_submit: {} } });
  await publicForm({ action: "submit", token: TOKEN, turnstile_token: "x", payload: { ...payload, tags: ["vip"], uhid: "X1" } }, null, deps);
  assertEquals(calls[0]!.includes("vip"), false);
  assertEquals(calls[0]!.includes("uhid"), false);
});

Deno.test("submit: a bad phone or missing name is refused", async () => {
  const { deps, calls } = fakeDeps();
  const bad = await publicForm({ action: "submit", token: TOKEN, turnstile_token: "x", payload: { full_name: "A", phone_e164: "98450" } }, null, deps);
  assertEquals(bad.status, 400);
  const noName = await publicForm({ action: "submit", token: TOKEN, turnstile_token: "x", payload: { phone_e164: "+919811122233" } }, null, deps);
  assertEquals(noName.status, 400);
  assertEquals(calls, []);
});

Deno.test("submit: expired link and rate limit map to clear answers", async () => {
  const expired = fakeDeps({ rpc: { public_form_submit: { error: "link_expired" } } });
  assertEquals((await publicForm({ action: "submit", token: TOKEN, turnstile_token: "x", payload }, null, expired.deps)).status, 410);
  const limited = fakeDeps({ rpc: { public_form_submit: { error: "rate_limited" } } });
  assertEquals((await publicForm({ action: "submit", token: TOKEN, turnstile_token: "x", payload }, null, limited.deps)).status, 429);
});
