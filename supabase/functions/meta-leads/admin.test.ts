// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import { type AdminDeps, adminSchema, check, connect, importLeads } from "./admin.ts";

Deno.test("staff requests: retry, check, connect, import of 1–90 days; nothing else", () => {
  assertEquals(adminSchema.safeParse({ action: "retry", leadgen_id: "123456" }).success, true);
  assertEquals(adminSchema.safeParse({ action: "check" }).success, true);
  assertEquals(adminSchema.safeParse({ action: "connect" }).success, true);
  assertEquals(adminSchema.safeParse({ action: "import", days: 30 }).success, true);
  assertEquals(adminSchema.safeParse({ action: "import", days: 0 }).success, false);
  assertEquals(adminSchema.safeParse({ action: "import", days: 91 }).success, false);
  assertEquals(adminSchema.safeParse({ action: "import" }).success, false);
  assertEquals(adminSchema.safeParse({ action: "check", extra: 1 }).success, false);
  assertEquals(adminSchema.safeParse({ action: "delete" }).success, false);
});

const lead = (id: string, phone: string) => ({
  id,
  created_time: "2026-10-20T10:00:00+0000",
  field_data: [{ name: "full_name", values: [`Lead ${id}`] }, { name: "phone_number", values: [phone] }],
  campaign_id: "9",
  campaign_name: "Nose Oct",
  form_id: "77",
});

function fake(opts: { fail?: Record<string, string>; subscribed?: string[]; leads?: ReturnType<typeof lead>[]; seen?: string[];
                      duplicate?: string[]; clock?: number[] } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const graphCalls: { path: string; key: string; params?: Record<string, string> }[] = [];
  const posts: string[] = [];
  let tick = 0;
  const deps: AdminDeps = {
    systemKey: "SYS",
    pageId: "500",
    appId: "42",
    now: () => (opts.clock ? opts.clock[Math.min(tick++, opts.clock.length - 1)] : 1_761_000_000_000),
    fieldMap: async () => ({}),
    graph: async (path, key, params) => {
      graphCalls.push({ path, key, params });
      for (const [k, msg] of Object.entries(opts.fail ?? {})) if (path === k || path.endsWith(k)) throw new Error(msg);
      if (path === "me") return { id: "1", name: "Pearl CRM bot" };
      if (path === "500") return { name: "Pearl Clinic", access_token: "PAGE" };
      if (path === "500/leadgen_forms") return { data: [{ id: "77" }] };
      if (path === "77/leads") {
        const all = opts.leads ?? [];
        return { data: all.slice(0, 2), paging: all.length > 2 ? { next: "https://graph.facebook.com/v23.0/77/leads?after=x" } : {} };
      }
      if (path.startsWith("https://")) return { data: (opts.leads ?? []).slice(2) };
      if (path === "500/subscribed_apps") return { data: [{ id: "42", subscribed_fields: opts.subscribed ?? [] }] };
      if (path === "me/adaccounts") return { data: [{ name: "Pearl Ads" }] };
      return {};
    },
    post: async (path) => {
      posts.push(path);
      return { success: true };
    },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "meta_lead_received") return { data: { process: !(opts.seen ?? []).includes(String(args.p_leadgen_id)) }, error: null };
      if (fn === "meta_lead_import") {
        if (!(args.p_lead as { phone: string }).phone) return { data: { status: "failed" }, error: null };
        const dup = (opts.duplicate ?? []).includes(String(args.p_leadgen_id));
        return { data: dup ? { status: "duplicate" } : { status: "created", lead_id: `L${args.p_leadgen_id}` }, error: null };
      }
      return { data: 1, error: null };
    },
  };
  return { deps, calls, graphCalls, posts };
}

Deno.test("check: every step green when Meta allows it all; forms are read with the Page's own key", async () => {
  const f = fake({ subscribed: ["leadgen"], leads: [lead("1001", "9845012345")] });
  const r = await check(f.deps);
  assertEquals(r.steps.map((s) => [s.key, s.ok]), [["token", true], ["page", true], ["leads", true], ["webhook", true], ["ads", true]]);
  assertEquals(r.can_connect, false);
  assertEquals(f.graphCalls.find((c) => c.path === "500/leadgen_forms")!.key, "PAGE");
});

Deno.test("check: a missing permission shows as ✗ with Meta's reason; an unsubscribed page offers Connect", async () => {
  const f = fake({ fail: { "77/leads": "(#200) Requires leads_retrieval permission" } });
  const r = await check(f.deps);
  const byKey = Object.fromEntries(r.steps.map((s) => [s.key, s]));
  assertEquals([byKey.leads.ok, byKey.leads.detail], [false, "(#200) Requires leads_retrieval permission"]);
  assertEquals([byKey.webhook.ok, byKey.webhook.detail], [false, "not_subscribed"]);
  assertEquals(r.can_connect, true);
});

Deno.test("check: no Page key means the page steps fail and Connect isn't offered", async () => {
  const f = fake({ fail: { "500": "Unsupported get request" } });
  const r = await check(f.deps);
  assertEquals(r.steps.map((s) => [s.key, s.ok]), [["token", true], ["page", false], ["leads", false], ["webhook", false], ["ads", true]]);
  assertEquals(r.can_connect, false);
});

Deno.test("connect: subscribes the page to leadgen with the Page's key; Meta's refusal is shown", async () => {
  const f = fake();
  assertEquals(await connect(f.deps), { ok: true });
  assertEquals(f.posts, ["500/subscribed_apps"]);
  const no = fake({ fail: { "500": "(#200) Requires pages_manage_metadata" } });
  assertEquals(await connect(no.deps), { ok: false, error: "(#200) Requires pages_manage_metadata" });
});

Deno.test("import: new leads made quietly, repeats skipped, duplicates counted, one summary; all pages followed", async () => {
  const f = fake({
    leads: [lead("1001", "9845012345"), lead("1002", "9845012346"), lead("1003", "9845012347"), lead("1004", "12")],
    seen: ["1002"],
    duplicate: ["1003"],
  });
  const s = await importLeads(30, Number.MAX_SAFE_INTEGER, f.deps);
  assertEquals(s, { forms: 1, seen: 4, created: 1, duplicate: 1, failed: 1, already: 1, done: true });
  const first = f.graphCalls.find((c) => c.path === "77/leads")!;
  assertEquals(first.key, "PAGE");
  assertEquals(JSON.parse(first.params!.filtering)[0], { field: "time_created", operator: "GREATER_THAN", value: 1_761_000_000 - 30 * 86_400 });
  const made = f.calls.filter((c) => c.fn === "meta_lead_import");
  assertEquals((made[0].args.p_lead as { source_detail: Record<string, string> }).source_detail.campaign_id, "9");
  // A lead without a usable number still goes to Postgres, which records it as failed.
  assertEquals(made.at(-1)!.args.p_lead, { name: "", phone: "" });
  assertEquals(f.calls.at(-1), { fn: "meta_lead_import_summary", args: { p_lead_ids: ["L1001"] } });
});

Deno.test("import: stops at the time limit and says it isn't done", async () => {
  const f = fake({ leads: [lead("1001", "9845012345"), lead("1002", "9845012346")], clock: [0, 0, 0, 200] });
  const s = await importLeads(30, 100, f.deps);
  assertEquals([s.done, s.seen, s.created], [false, 1, 1]);
  assertEquals(f.calls.at(-1)!.fn, "meta_lead_import_summary");
});

Deno.test("import: Meta refusing is reported, nothing summarised", async () => {
  const f = fake({ fail: { "77/leads": "(#200) Requires leads_retrieval permission" } });
  const s = await importLeads(30, Number.MAX_SAFE_INTEGER, f.deps);
  assertEquals([s.done, s.error], [false, "(#200) Requires leads_retrieval permission"]);
  assertEquals(f.calls.some((c) => c.fn === "meta_lead_import_summary"), false);
});
