import { assert, assertEquals } from "@std/assert";
import type { Mail } from "../_shared/email.ts";
import { requestSchema, run, summaryMail, type Deps } from "./logic.ts";

const data = {
  date: "2026-10-26", revenue_paise: 15000000, collected_paise: 12000050, bills: 12,
  by_mode: [{ label: "UPI", paise: 10000000 }, { label: "Cash", paise: 2000050 }],
  appointments: 30, arrived: 26, no_shows: 2, new_patients: 5, pharmacy_sales_paise: 450000, admissions: 1,
  new_leads: 9, converted: 2, bdm_days: 3, bdm_visits: 11, followups_overdue: 4, stock_alerts: 2, storage_pct: 41.5,
};

function fakeDeps(payload: unknown, failFor: string[] = []) {
  const sent: Mail[] = [];
  const done: Record<string, unknown>[] = [];
  const deps: Deps = {
    rpc: <T>(fn: string, args: Record<string, unknown>) => {
      if (fn === "daily_summary_done") done.push(args);
      return Promise.resolve({ data: (fn === "daily_summary_payload" ? payload : null) as T | null, error: null });
    },
    send: (mail) => {
      sent.push(mail);
      const bad = failFor.includes(mail.to[0].email);
      return Promise.resolve({ ok: !bad, status: bad ? 400 : 201 });
    },
    base: "https://crm.example.com",
  };
  return { deps, sent, done };
}

Deno.test("daily-summary: the request is a date and the run id", () => {
  assert(requestSchema.safeParse({ date: "2026-10-26", run_id: 7 }).success);
  assert(!requestSchema.safeParse({ date: "26/10/2026", run_id: 7 }).success);
  assert(!requestSchema.safeParse({ date: "2026-10-26" }).success);
});

Deno.test("daily-summary: the email shows the day's numbers in rupees", () => {
  const mail = summaryMail({ data, clinic: "Demo <Clinic>", recipients: [] }, { email: "a@example.com" }, "https://crm.example.com");
  assertEquals(mail.subject, "Daily summary · 26/10/2026 · Demo <Clinic>");
  assert(mail.html.includes("₹1,50,000.00"));
  assert(mail.html.includes("₹1,20,000.50"));
  assert(mail.html.includes("Demo &lt;Clinic&gt;"), "the clinic name is escaped");
  assert(mail.text.includes("No-shows: 2"));
  assert(mail.html.includes("https://crm.example.com/dashboard"));
});

Deno.test("daily-summary: one email per recipient, run marked done", async () => {
  const { deps, sent, done } = fakeDeps({ data, clinic: "Demo", recipients: [{ email: "a@example.com", name: "A" }, { email: "b@example.com" }] });
  assertEquals(await run({ date: "2026-10-26", run_id: 3 }, true, deps), { ok: true, sent: 2, failed: 0 });
  assertEquals(sent.map((m) => m.to[0].email), ["a@example.com", "b@example.com"]);
  assertEquals(done[0], { p_run_id: 3, p_ok: true, p_detail: { sent: 2, failed: 0 } });
});

Deno.test("daily-summary: a refused address is counted; bad addresses are skipped", async () => {
  const { deps, sent } = fakeDeps(
    { data, recipients: [{ email: "a@example.com" }, { email: "not-an-email" }, { email: "b@example.com" }] },
    ["b@example.com"],
  );
  assertEquals(await run({ date: "2026-10-26", run_id: 4 }, true, deps), { ok: false, sent: 1, failed: 1 });
  assertEquals(sent.length, 2);
});

Deno.test("daily-summary: without Brevo the run is closed as not configured", async () => {
  const { deps, done, sent } = fakeDeps({ data, recipients: [{ email: "a@example.com" }] });
  assertEquals(await run({ date: "2026-10-26", run_id: 5 }, false, deps), { ok: false, error: "not_configured" });
  assertEquals(sent.length, 0);
  assertEquals(done[0].p_ok, false);
});
