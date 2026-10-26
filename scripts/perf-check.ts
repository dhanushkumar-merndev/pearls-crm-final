/**
 * Performance pass (PLAN.md E2 / E3 row 15) on the online project, without leaving anything behind.
 *
 * In ONE transaction that is always rolled back:
 *   1. a "perf seed" the size of about two busy years: 50,000 patients, 120,000 appointments,
 *      40,000 bills (80,000 lines) and payments, 30,000 leads, 60,000 calls, 30,000 WhatsApp
 *      messages and two years of the daily KPI rollup;
 *   2. every main screen's RPC (the admin dashboard per part: the page asks for its parts side by side) is run once to warm up, then 15 times as the role that uses it, timed inside the
 *      database (network delay is not counted), and compared with its budget:
 *      search < 150 ms, lists and dashboards < 300 ms (p95).
 *   3. the seeded tables are compacted (VACUUM FULL). A rolled-back insert still leaves its rows on disk
 *      as dead space (~600 MB per run); on the free plan, a database over 500 MB turns read-only.
 *      The run refuses to start when the database is already over 150 MB.
 *
 *   pnpm perf            (needs DATABASE_URL in .env)
 *   pnpm perf --pending  first applies migrations not yet online, inside the same rolled-back transaction
 *   PERF_ONLY=<regex> / PERF_RUNS=<n> narrow a run while tuning; PERF_EXPLAIN=1 prints each plan.
 *   PERF_EXTRA=cases.json pnpm perf   adds cases ({name, as, budget, sql}; as "postgres" = no role
 *                                     switch, for timing pieces of a function while tuning it)
 * Exit code 1 when any p95 is over budget.
 */
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { loadEnv } from "./env-sync.ts";

const RUNS = Number(process.env.PERF_RUNS ?? 15);
const url = loadEnv().get("DATABASE_URL");
if (!url) {
  console.error("✖ DATABASE_URL missing in .env");
  process.exit(1);
}

const ADMIN = "5eed0000-0000-4000-a000-00000000000a";
const RECEPTION = "5eed0000-0000-4000-a000-0000000000b1";
const MANAGER = "5eed0000-0000-4000-a000-0000000000c2";
const SALES = Array.from({ length: 6 }, (_, i) => `5eed0000-0000-4000-a000-0000000000c${(i + 3).toString(16)}`);

const SEED = `
-- The rollup table first: a background job or autovacuum touching it mid-seed would deadlock with the seed.
lock table public.kpi_daily in share row exclusive mode;
insert into auth.users (id, email) values
  ('${ADMIN}', 'perf-admin@staff.invalid'), ('${RECEPTION}', 'perf-rec@staff.invalid'), ('${MANAGER}', 'perf-mgr@staff.invalid')
  ${SALES.map((id, i) => `, ('${id}', 'perf-sales${i}@staff.invalid')`).join("")};
insert into public.staff (id, role, full_name, username) values
  ('${ADMIN}', 'admin', 'Perf Admin', 'perfadmin'), ('${RECEPTION}', 'receptionist', 'Perf Reception', 'perfrec'),
  ('${MANAGER}', 'sales_manager', 'Perf Manager', 'perfmgr')
  ${SALES.map((id, i) => `, ('${id}', 'sales_executive', 'Perf Sales ${i}', 'perfsales${i}')`).join("")};

-- Seeding only: the audit / KPI / WhatsApp triggers would multiply the work. Rolled back anyway.
alter table public.patients disable trigger user;
alter table public.appointments disable trigger user;
alter table public.bills disable trigger user;
alter table public.bill_items disable trigger user;
alter table public.payments disable trigger user;
alter table public.leads disable trigger user;
alter table public.call_logs disable trigger user;
alter table public.wa_messages disable trigger user;

create temp table names as
select f || ' ' || l as name, row_number() over () as n
from unnest(array['Asha','Ravi','Priya','Arjun','Kavya','Suresh','Meena','Rahul','Divya','Anil','Lakshmi','Vikram','Sneha','Kiran','Pooja','Manoj','Deepa','Sanjay','Nisha','Ganesh']) f
cross join unnest(array['Rao','Kumar','Sharma','Reddy','Nair','Iyer','Gowda','Patel','Shetty','Menon','Joshi','Hegde','Pillai','Das','Bhat']) l;

insert into public.patients (id, uhid, full_name, phone_e164, gender, created_at)
select gen_random_uuid(), 'PERF-' || lpad(g::text, 6, '0'), (select name from names where n = 1 + g % 300) || ' ' || g,
       '+91' || (7000000000 + g)::text, (array['male','female']::public.gender[])[1 + g % 2],
       now() - ((g % 730) || ' days')::interval
from generate_series(1, 50000) g;
create temp table pp as select id, row_number() over (order by uhid) as n from public.patients where uhid like 'PERF-%';
create index on pp (n);
create temp table docs as select id, row_number() over (order by id) as n from public.doctors where active;
create temp table modes as select id, row_number() over (order by id) as n from public.lookup_values where kind = 'payment_mode';
create temp table sources as select id, row_number() over (order by id) as n from public.lookup_values where kind = 'lead_source';
create temp table meds as select id, row_number() over (order by id) as n from public.pharmacy_items;

insert into public.appointments (patient_id, doctor_id, appt_date, slot_start, slot_end, status, type, created_at, arrived_at)
select p.id, d.id, a.day, a.at, a.at + interval '15 minutes',
       (array['done','done','done','no_show','cancelled','confirmed','pending_confirmation'])[1 + g % 7]::public.appt_status,
       'consultation', a.at - interval '2 days', case when g % 7 < 3 then a.at end
from generate_series(1, 120000) g
cross join lateral (select (current_date - (g % 730))::date as day) dd
cross join lateral (select private.ist_at(dd.day, (lpad((10 + g % 9)::text, 2, '0') || ':' || lpad((15 * (g % 4))::text, 2, '0'))::time) as at, dd.day) a
join pp p on p.n = 1 + (g * 7) % 50000
join docs d on d.n = 1 + g % (select count(*) from docs);

insert into public.bills (id, bill_type, bill_no, fy, status, patient_id, doctor_id, bill_at, gross_paise, taxable_paise, total_paise, finalized_at)
select gen_random_uuid(), 'procedure_receipt', 'PERF/' || g, '2099-00', 'finalized', p.id, d.id, now() - ((g % 730) || ' days')::interval,
       amt, amt, amt, now() - ((g % 730) || ' days')::interval
from generate_series(1, 40000) g
cross join lateral (select (50000 + (g * 7919) % 450000)::bigint as amt) x
join pp p on p.n = 1 + (g * 13) % 50000
join docs d on d.n = 1 + g % (select count(*) from docs);
insert into public.bill_items (bill_id, line_no, kind, pharmacy_item_id, description, rate_paise, qty, gross_paise, taxable_paise, total_paise)
select b.id, k, case when k = 2 and m.id is not null then 'pharmacy' else 'service' end, case when k = 2 then m.id end,
       'Perf line', b.total_paise / 2, 1, b.total_paise / 2, b.total_paise / 2, b.total_paise / 2
from public.bills b cross join generate_series(1, 2) k
left join meds m on m.n = 1 + (abs(hashtext(b.id::text)) % greatest((select count(*) from meds), 1))
where b.bill_no like 'PERF/%';
insert into public.payments (patient_id, kind, mode_id, amount_paise, received_at)
select b.patient_id, 'payment', m.id, b.total_paise, b.bill_at
from public.bills b join modes m on m.n = 1 + (abs(hashtext(b.id::text)) % (select count(*) from modes))
where b.bill_no like 'PERF/%';

insert into public.leads (name, phone_e164, lead_date, stage, assigned_to, source_id, created_via, created_at, converted_at, amount_finalised_paise, amount_finalised_at)
select (select name from names where n = 1 + g % 300) || ' L' || g, '+91' || (8000000000 + g)::text, current_date - (g % 730),
       (array['new','contacted','interested','consultation_booked','converted','not_reachable','junk'])[1 + g % 7]::public.lead_stage,
       (array[${SALES.map((s) => `'${s}'::uuid`).join(", ")}])[1 + g % ${SALES.length}], s.id, 'web',
       now() - ((g % 730) || ' days')::interval,
       case when g % 7 = 4 then now() - ((g % 730) || ' days')::interval end,
       case when g % 7 = 4 then 2500000 end, case when g % 7 = 4 then now() - ((g % 730) || ' days')::interval end
from generate_series(1, 30000) g
join sources s on s.n = 1 + g % (select count(*) from sources);

insert into public.call_logs (id, staff_id, lead_id, phone_e164, direction, started_at, duration_s, outcome, source)
select gen_random_uuid(), l.assigned_to, l.id, l.phone_e164, 'outgoing', l.created_at + (k || ' hours')::interval, 30 + k * 40,
       (array['connected','no_answer','busy','connected'])[1 + k % 4]::public.call_outcome, 'app'
from public.leads l cross join generate_series(1, 2) k where l.assigned_to = any (array[${SALES.map((s) => `'${s}'::uuid`).join(", ")}]);

insert into public.wa_messages (phone_e164, patient_id, direction, kind, status, status_rank, est_cost_paise, created_at)
select '+91' || (7000000000 + 1 + g % 50000)::text, p.id, 'outbound', 'template',
       (array['sent','delivered','read'])[1 + g % 3]::public.wa_status, 1 + g % 3, 12, now() - ((g % 730) || ' days')::interval
from generate_series(1, 30000) g join pp p on p.n = 1 + g % 50000;

insert into public.kpi_daily (day, metric, dim_kind, dim_id, value)
select d, m, 'clinic', '', 100000 + (extract(doy from d)::int * 977) % 900000
from generate_series(current_date - 730, current_date - 1, interval '1 day') d,
     unnest(array['revenue_paise','collected_paise','discount_paise','appointments_count','arrived_count','no_show_count','new_patients']) m
on conflict do nothing;

alter table public.patients enable trigger user;
alter table public.appointments enable trigger user;
alter table public.bills enable trigger user;
alter table public.bill_items enable trigger user;
alter table public.payments enable trigger user;
alter table public.leads enable trigger user;
alter table public.call_logs enable trigger user;
alter table public.wa_messages enable trigger user;
analyze public.patients, public.appointments, public.bills, public.bill_items, public.payments, public.leads, public.call_logs,
        public.wa_messages, public.kpi_daily;

-- Times one call inside the database (median, p95, worst), as the current role.
create function pg_temp.bench(p_sql text, p_runs int)
returns table (p50 numeric, p95 numeric, worst numeric)
language plpgsql as $$
declare
  t timestamptz;
  ms numeric[] := '{}';
begin
  execute p_sql; -- warm-up (caches and plans, as in daily use); not counted
  for i in 1..p_runs loop
    t := clock_timestamp();
    execute p_sql;
    ms := ms || round(extract(epoch from clock_timestamp() - t)::numeric * 1000, 1);
  end loop;
  return query select percentile_cont(0.5) within group (order by x)::numeric,
                      percentile_cont(0.95) within group (order by x)::numeric, max(x) from unnest(ms) x;
end $$;
grant execute on function pg_temp.bench(text, int) to authenticated;
`;

// Today in IST as a literal (the roles being timed can't call the private date helpers).
const today = `'${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}'::date`;
const CASES: { name: string; as: string; budget: number; sql: string }[] = [
  { name: "search: name", as: RECEPTION, budget: 150, sql: "select public.global_search('Kavya Nair', 20)" },
  { name: "search: phone digits", as: RECEPTION, budget: 150, sql: "select public.global_search('7000012345', 20)" },
  { name: "search: UHID", as: RECEPTION, budget: 150, sql: "select public.global_search('PERF-0491', 20)" },
  { name: "patients: recent", as: RECEPTION, budget: 300, sql: "select public.patients_recent(null, 50)" },
  { name: "today board", as: RECEPTION, budget: 300, sql: `select public.today_board(${today})` },
  { name: "reception dashboard", as: RECEPTION, budget: 300, sql: `select public.dashboard_reception(${today})` },
  {
    name: "appointments table (month)", as: RECEPTION, budget: 300,
    sql: `select public.appointments_table(jsonb_build_object('from', ${today} - 30, 'to', ${today}), 'when', true, 0, 100)`,
  },
  { name: "bills table (month)", as: RECEPTION, budget: 300, sql: `select public.bills_table(jsonb_build_object('from', ${today} - 30, 'to', ${today}), 0, 100)` },
  {
    name: "leads table (month)", as: MANAGER, budget: 300,
    sql: `select public.leads_table(jsonb_build_object('from', ${today} - 30, 'to', ${today}), 'lead_date', true, 0, 100)`,
  },
  { name: "sales dashboard (month)", as: MANAGER, budget: 300, sql: `select public.dashboard_sales_manager(${today} - 29, ${today}, null, true)` },
  {
    name: "admin dash month: summary", as: ADMIN, budget: 300,
    sql: `select public.dashboard_admin(${today} - 29, ${today}, true, array['summary'])`,
  },
  {
    name: "admin dash month: previous", as: ADMIN, budget: 300,
    sql: `select public.dashboard_admin(${today} - 29, ${today}, true, array['previous'])`,
  },
  {
    name: "admin dash month: money", as: ADMIN, budget: 300,
    sql: `select public.dashboard_admin(${today} - 29, ${today}, true, array['money'])`,
  },
  {
    name: "admin dash year: summary", as: ADMIN, budget: 300,
    sql: `select public.dashboard_admin(${today} - 364, ${today}, true, array['summary'])`,
  },
  {
    name: "admin dash year: previous", as: ADMIN, budget: 300,
    sql: `select public.dashboard_admin(${today} - 364, ${today}, true, array['previous'])`,
  },
  {
    name: "admin dash year: money", as: ADMIN, budget: 300,
    sql: `select public.dashboard_admin(${today} - 364, ${today}, true, array['money'])`,
  },
  { name: "WhatsApp inbox", as: RECEPTION, budget: 300, sql: "select public.wa_inbox(false, null, 50)" },
  { name: "audit log page", as: ADMIN, budget: 300, sql: "select public.audit_list(null, null, null, null, null, null, 50)" },
];

if (process.env.PERF_EXTRA) CASES.push(...(JSON.parse(readFileSync(process.env.PERF_EXTRA, "utf8")) as typeof CASES));
// PERF_ONLY=regex keeps only the matching cases.
const only = process.env.PERF_ONLY ? new RegExp(process.env.PERF_ONLY) : null;
if (only) CASES.splice(0, CASES.length, ...CASES.filter((c) => only.test(c.name)));

const client = new pg.Client({ connectionString: url, statement_timeout: 600_000 });
await client.connect();
const SEEDED = ["appointments", "bill_items", "bills", "payments", "patients", "leads", "call_logs", "wa_messages", "kpi_daily"];
const size = async () =>
  Number((await client.query<{ mb: string }>("select pg_database_size(current_database()) / 1048576 as mb")).rows[0]!.mb);
const before = await size();
if (before > 150) {
  console.error(`✖ the database is already ${before} MB; the seed would push it past the free plan's 500 MB`);
  await client.end();
  process.exit(1);
}
let over = 0;
try {
  await client.query("begin");
  if (process.argv.includes("--pending")) {
    const { rows } = await client.query<{ version: string }>("select version from supabase_migrations.schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && !applied.has(f.split("_")[0]!)).sort()) {
      await client.query(readFileSync(new URL(f, dir), "utf8"));
      console.log(`• applied ${f} (not yet online)`);
    }
  }
  const t0 = Date.now();
  await client.query(SEED);
  console.log(`• perf seed loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s (rolled back at the end)`);
  console.log(`\n${"screen".padEnd(30)} ${"p50".padStart(8)} ${"p95".padStart(8)} ${"worst".padStart(8)}  budget`);
  for (const c of CASES) {
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: c.as === "postgres" ? ADMIN : c.as, role: "authenticated" })]);
    if (c.as !== "postgres") await client.query("set local role authenticated");
    if (process.env.PERF_EXPLAIN) {
      // Tuning aid: the plan with real timings instead of the benchmark.
      const plan = await client.query<{ "QUERY PLAN": string }>(`explain (analyze, buffers) ${c.sql}`);
      console.log(`\n── ${c.name}\n${plan.rows.map((r) => r["QUERY PLAN"]).join("\n")}`);
      await client.query("reset role");
      continue;
    }
    const { rows } = await client.query<{ p50: string; p95: string; worst: string }>("select * from pg_temp.bench($1, $2)", [c.sql, RUNS]);
    await client.query("reset role");
    const r = rows[0]!;
    const bad = Number(r.p95) > c.budget;
    if (bad) over++;
    console.log(`${bad ? "✖" : "✔"} ${c.name.padEnd(28)} ${r.p50.padStart(8)} ${r.p95.padStart(8)} ${r.worst.padStart(8)}  < ${c.budget} ms`);
  }
} finally {
  await client.query("rollback");
  // Hand the dead rows' space back (in case the plan had already turned the database read-only, too).
  await client.query("set session characteristics as transaction read write");
  for (const t of SEEDED) await client.query(`vacuum (full, analyze) public.${t}`);
  console.log(`• database ${before} MB before, ${await size()} MB after compacting`);
  await client.end();
}
console.log(over ? `\n✖ ${over} over budget` : "\n✔ every screen is inside its budget");
process.exit(over ? 1 : 0);
