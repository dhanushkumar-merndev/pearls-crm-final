// deno-lint-ignore-file require-await -- fakes implement async interfaces without awaiting
import { assertEquals } from "@std/assert";
import { budgetPaise, dayWindows, type Deps, GraphError, leadCount, shiftDay, sync, syncSchema, toPaise } from "./logic.ts";

Deno.test("money: Meta's rupee strings become whole paise without float errors", () => {
  assertEquals(toPaise("1234.56"), 123456);
  assertEquals(toPaise("0.1"), 10);
  assertEquals(toPaise("19.995"), 2000);
  assertEquals(toPaise("19.994"), 1999);
  assertEquals(toPaise("137684.86"), 13768486);
  assertEquals(toPaise(""), 0);
  assertEquals(toPaise(undefined), 0);
  assertEquals(toPaise("-5"), 0);
  assertEquals(budgetPaise("150000", "INR"), 150000);
  assertEquals(budgetPaise("500", "JPY"), 50000);
  assertEquals(budgetPaise(undefined, "INR"), null);
});

Deno.test("leads: the first lead action type wins (Meta repeats the same leads under several)", () => {
  assertEquals(leadCount([{ action_type: "link_click", value: "40" }, { action_type: "lead", value: "7" },
                          { action_type: "onsite_conversion.lead_grouped", value: "7" }]), 7);
  assertEquals(leadCount([{ action_type: "onsite_conversion.lead_grouped", value: "3" }]), 3);
  assertEquals(leadCount(undefined), 0);
});

Deno.test("days: windows of 30, oldest first, calendar-safe", () => {
  assertEquals(shiftDay("2026-03-01", -1), "2026-02-28");
  assertEquals(dayWindows("2026-08-02", "2026-10-30"), [
    { since: "2026-08-02", until: "2026-08-31" },
    { since: "2026-09-01", until: "2026-09-30" },
    { since: "2026-10-01", until: "2026-10-30" },
  ]);
  assertEquals(dayWindows("2026-10-30", "2026-10-30"), [{ since: "2026-10-30", until: "2026-10-30" }]);
});

Deno.test("request body: only an optional source", () => {
  assertEquals(syncSchema.safeParse({}).success, true);
  assertEquals(syncSchema.safeParse({ source: "staff" }).success, true);
  assertEquals(syncSchema.safeParse({ source: "x" }).success, false);
  assertEquals(syncSchema.safeParse({ extra: 1 }).success, false);
});

function fake(opts: { account?: Record<string, unknown> | null; failOn?: string; code?: number } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const insightRanges: string[] = [];
  const deps: Deps = {
    today: () => "2026-10-30",
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "ads_account_get") return { data: opts.account ?? null, error: null };
      if (fn === "ads_save_entities") return { data: { campaigns: 1, ads: 1 }, error: null };
      return { data: 1, error: null };
    },
    graph: async (path, params) => {
      if (opts.failOn && path.includes(opts.failOn)) throw new GraphError("busy", opts.code ?? 17);
      if (path === "me/adaccounts") return { data: [{ account_id: "111", account_status: 2 }, { account_id: "222", account_status: 1 }] };
      if (path.endsWith("/campaigns")) return { data: [{ id: "9", name: "Nose Oct", effective_status: "ACTIVE", daily_budget: "50000" }] };
      if (path.endsWith("/ads")) {
        return { data: [{ id: "91", name: "Ad 1", campaign_id: "9", adset: { name: "Set A" }, creative: { thumbnail_url: "https://x/t.jpg" } }] };
      }
      if (path.endsWith("/insights")) {
        const r = JSON.parse(params!.time_range) as { since: string; until: string };
        insightRanges.push(`${params!.level} ${r.since}..${r.until}`);
        return {
          data: [{ campaign_id: "9", ad_id: params!.level === "ad" ? "91" : undefined, date_start: r.until, spend: "100.5",
                   impressions: "1000", reach: "800", clicks: "20", inline_link_clicks: "12", actions: [{ action_type: "lead", value: "2" }] }],
          paging: {},
        };
      }
      return { name: "Pearl Ads", currency: "INR", timezone_name: "Asia/Kolkata" };
    },
  };
  return { deps, calls, insightRanges };
}

Deno.test("first run: picks the active ad account, saves campaigns and ads, pulls 90 days", async () => {
  const f = fake();
  const s = await sync({ backfill: true }, f.deps);
  assertEquals(s.ok, true);
  assertEquals(s.account, "222");
  const ents = f.calls.find((c) => c.fn === "ads_save_entities")!.args;
  assertEquals((ents.p_campaigns as { daily_budget_paise: number }[])[0].daily_budget_paise, 50000);
  assertEquals((ents.p_ads as { adset_name: string; thumbnail_url: string }[])[0], {
    id: "91", campaign_id: "9", adset_name: "Set A", name: "Ad 1", status: null, effective_status: null,
    created_time: null, updated_time: null, thumbnail_url: "https://x/t.jpg", preview_url: null,
  } as never);
  assertEquals(f.insightRanges, [
    "campaign 2026-08-02..2026-08-31", "ad 2026-08-02..2026-08-31",
    "campaign 2026-09-01..2026-09-30", "ad 2026-09-01..2026-09-30",
    "campaign 2026-10-01..2026-10-30", "ad 2026-10-01..2026-10-30",
  ]);
  const daily = f.calls.filter((c) => c.fn === "ads_save_daily").map((c) => (c.args.p_rows as Record<string, unknown>[])[0]);
  assertEquals(daily[0], { campaign_id: "9", ad_id: "", day: "2026-08-31", spend_paise: 10050, impressions: 1000, reach: 800,
                           clicks: 20, link_clicks: 12, meta_leads: 2 });
  assertEquals(daily[1].ad_id, "91");
  assertEquals(f.calls.at(-1), { fn: "ads_sync_done", args: { p_account: "222", p_error: null, p_synced_through: "2026-10-30",
                                                                p_backfilled_from: "2026-08-02" } });
});

Deno.test("later runs: re-read 3 days; the timer also fills 30 older days, Sync now doesn't", async () => {
  const account = { id: "222", synced_through: "2026-10-29", backfilled_from: "2026-08-02" };
  const timer = fake({ account });
  await sync({ backfill: true }, timer.deps);
  assertEquals(timer.insightRanges, [
    "campaign 2026-07-03..2026-08-01", "ad 2026-07-03..2026-08-01",
    "campaign 2026-10-26..2026-10-30", "ad 2026-10-26..2026-10-30",
  ]);
  assertEquals(timer.calls.at(-1)!.args.p_backfilled_from, "2026-07-03");

  const button = fake({ account });
  await sync({ backfill: false }, button.deps);
  assertEquals(button.insightRanges, ["campaign 2026-10-26..2026-10-30", "ad 2026-10-26..2026-10-30"]);
  assertEquals(button.calls.at(-1)!.args.p_backfilled_from, "2026-08-02");
});

Deno.test("Meta busy or broken: the error is recorded and the run ends cleanly", async () => {
  const busy = fake({ account: { id: "222", synced_through: null, backfilled_from: null }, failOn: "/insights", code: 17 });
  const s = await sync({ backfill: true }, busy.deps);
  assertEquals([s.ok, s.rate_limited], [false, true]);
  assertEquals(String(busy.calls.at(-1)!.args.p_error).startsWith("Meta is busy"), true);

  const broken = fake({ account: { id: "222", synced_through: null, backfilled_from: null }, failOn: "/campaigns", code: 190 });
  const b = await sync({ backfill: true }, broken.deps);
  assertEquals([b.ok, b.rate_limited, b.error], [false, false, "busy"]);
});

Deno.test("no ad account visible: nothing saved", async () => {
  const f = fake();
  f.deps.graph = async () => ({ data: [] });
  assertEquals(await sync({ backfill: true }, f.deps), { ok: false, error: "no_ad_account" });
});
