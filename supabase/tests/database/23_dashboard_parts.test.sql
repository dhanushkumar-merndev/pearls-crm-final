-- Phase 15: the admin dashboard in parts (summary / previous / money), and the faster
-- "outstanding" and "by source" give the same answers as the straightforward queries they replaced
-- (kept here as the reference), on this database's data plus a known fixture.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

create function pg_temp.login(p_id uuid)
returns void
language plpgsql
as $$
begin
  reset role;
  if p_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated;

create temp table today as select (private.ist(now()))::date as d;
grant select on today to authenticated;
create temp table got (k text primary key, v jsonb);
grant select, insert on got to authenticated;

insert into auth.users (id, email) values
  ('23232323-0000-4000-a000-00000000000a', 'dp-admin@staff.invalid'),
  ('23232323-0000-4000-a000-0000000000b1', 'dp-rec@staff.invalid'),
  ('23232323-0000-4000-a000-0000000000c1', 'dp-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('23232323-0000-4000-a000-00000000000a', 'admin', 'DP Admin', 'dpadmin'),
  ('23232323-0000-4000-a000-0000000000b1', 'receptionist', 'DP Rec', 'dprec'),
  ('23232323-0000-4000-a000-0000000000c1', 'sales_executive', 'DP Sales', 'dpsales');
insert into public.lookup_values (id, kind, code, label) values
  ('23232323-5555-4000-a000-000000000001', 'lead_source', 'dp_one', 'DP Source One'),
  ('23232323-5555-4000-a000-000000000002', 'lead_source', 'dp_two', 'DP Source Two'),
  ('23232323-5555-4000-a000-000000000003', 'lead_source', 'dp_three', 'DP Source Three');
-- A: came from a lead (its own lead_id). B: no lead_id, two leads converted into them (the first counts).
insert into public.leads (id, name, phone_e164, assigned_to, source_id, created_at) values
  ('23232323-4444-4000-a000-000000000001', 'DP Lead A', '+919822200001', '23232323-0000-4000-a000-0000000000c1',
   '23232323-5555-4000-a000-000000000001', now() - interval '3 days');
insert into public.patients (id, uhid, full_name, phone_e164, lead_id) values
  ('23232323-1111-4000-a000-000000000001', 'DP-1', 'DP Patient A', '+919822200001', '23232323-4444-4000-a000-000000000001'),
  ('23232323-1111-4000-a000-000000000002', 'DP-2', 'DP Patient B', '+919822200002', null);
insert into public.leads (id, name, phone_e164, assigned_to, source_id, patient_id, created_at) values
  ('23232323-4444-4000-a000-000000000002', 'DP Lead B1', '+919822200002', '23232323-0000-4000-a000-0000000000c1',
   '23232323-5555-4000-a000-000000000002', '23232323-1111-4000-a000-000000000002', now() - interval '5 days'),
  ('23232323-4444-4000-a000-000000000003', 'DP Lead B2', '+919822200002', '23232323-0000-4000-a000-0000000000c1',
   '23232323-5555-4000-a000-000000000003', '23232323-1111-4000-a000-000000000002', now() - interval '1 day');

-- Two bills today: A pays part (owes the rest), B pays in full.
create temp table modes as select (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash') as cash,
                                  (select id from public.lookup_values where kind = 'bill_category' and code = 'procedure') as procedure;
grant select on modes to authenticated;
select pg_temp.login('23232323-0000-4000-a000-0000000000b1');
select public.create_bill('procedure_receipt', p, '{}', b) from (values
  ('23232323-1111-4000-a000-000000000001'::uuid, '23232323-2222-4000-a000-000000000001'::uuid),
  ('23232323-1111-4000-a000-000000000002', '23232323-2222-4000-a000-000000000002')) v (p, b);
select public.save_bill(b, '{}', jsonb_build_array(jsonb_build_object(
  'description', 'Consultation', 'category_id', (select procedure from modes), 'rate_paise', rate, 'qty', 1,
  'discount_type', 'amount', 'discount_value', 0, 'gst_rate_bp', 0)), 1)
from (values ('23232323-2222-4000-a000-000000000001'::uuid, 100000), ('23232323-2222-4000-a000-000000000002', 50000)) v (b, rate);
select public.finalize_bill(b, 2, jsonb_build_array(jsonb_build_object('mode_id', (select cash from modes), 'amount_paise', paid)))
from (values ('23232323-2222-4000-a000-000000000001'::uuid, 30000), ('23232323-2222-4000-a000-000000000002', 50000)) v (b, paid);

-- The queries the dashboard used before Phase 15 (the reference).
reset role;
create function pg_temp.old_outstanding()
returns jsonb
language sql
as $$
  with billed as (
    select b.patient_id, b.bill_at, sum(b.total_paise) over (partition by b.patient_id order by b.bill_at, b.id) as running
    from public.bills b where b.status = 'finalized'
  ), received as (
    select p.patient_id, sum(case when p.kind = 'refund' then -p.amount_paise else p.amount_paise end) as paid
    from public.payments p where p.cancelled_at is null group by p.patient_id
  ), owing as (
    select bl.patient_id, max(bl.running) - coalesce(max(r.paid), 0) as due,
           min(bl.bill_at) filter (where bl.running > coalesce(r.paid, 0)) as oldest
    from billed bl left join received r on r.patient_id = bl.patient_id
    group by bl.patient_id
  ), aged as (
    select o.due, case when (select d from today) - (private.ist(o.oldest))::date <= 30 then '0_30'
                       when (select d from today) - (private.ist(o.oldest))::date <= 60 then '31_60'
                       when (select d from today) - (private.ist(o.oldest))::date <= 90 then '61_90' else '90_plus' end as bucket
    from owing o where o.due > 0
  )
  select jsonb_build_object(
    'total_paise', coalesce((select sum(due) from aged), 0),
    'patients', (select count(*) from aged),
    'ageing', (select jsonb_agg(jsonb_build_object('bucket', bk, 'paise', coalesce((select sum(a.due) from aged a where a.bucket = bk), 0),
                                                   'patients', (select count(*) from aged a where a.bucket = bk)) order by ord)
               from unnest(array['0_30', '31_60', '61_90', '90_plus']) with ordinality u (bk, ord)));
$$;
create function pg_temp.old_by_source(p_lo timestamptz, p_hi timestamptz)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object('source_id', x.source_id, 'label', lv.label, 'paise', x.paise, 'patients', x.n)
                            order by x.source_id), '[]'::jsonb)
  from (
    select ls.source_id, sum(b.total_paise) as paise, count(distinct b.patient_id) as n
    from public.bills b
    join public.patients p on p.id = b.patient_id
    left join lateral (
      select l.source_id from public.leads l
      where (l.id = p.lead_id or l.patient_id = p.id) and l.deleted_at is null
      order by (l.id = p.lead_id) desc, l.created_at limit 1
    ) ls on true
    where b.status = 'finalized' and b.bill_at >= p_lo and b.bill_at < p_hi
    group by ls.source_id
  ) x left join public.lookup_values lv on lv.id = x.source_id;
$$;

------------------------------------------------------------------------------
-- Parts
------------------------------------------------------------------------------
select pg_temp.login('23232323-0000-4000-a000-00000000000a');
insert into got select 'money', public.dashboard_admin((select d from today) - 29, (select d from today), true, array['money']);
insert into got select 'summary', public.dashboard_admin((select d from today) - 29, (select d from today), true, array['summary']);
insert into got select 'previous', public.dashboard_admin((select d from today) - 29, (select d from today), true, array['previous']);
insert into got select 'all', public.dashboard_admin((select d from today) - 29, (select d from today), true);

select is((select array_agg(k order by k) from jsonb_object_keys((select v from got where k = 'money')) k),
  array['agreed_vs_billed', 'bucket', 'by_source', 'from', 'funnel', 'outstanding', 'to', 'top_medicines'],
  'the money part holds only its sections');
select is((select array_agg(k order by k) from jsonb_object_keys((select v from got where k = 'summary')) k),
  array['backup', 'bdm', 'bucket', 'from', 'integrations', 'kpis', 'pharmacy_stock', 'sessions', 'storage', 'to', 'trend'],
  'the summary part holds only its sections');
select is((select array_agg(k order by k) from jsonb_object_keys((select v from got where k = 'previous')) k),
  array['bucket', 'from', 'previous', 'to'], 'the previous part holds only the comparison');
-- The live sections (BDM positions, job and backup runs, storage) can change between the four calls
-- on a busy online database: those must be there; everything else must match exactly.
select is(((select v from got where k = 'money') || (select v from got where k = 'summary') || (select v from got where k = 'previous'))
            - array['bdm', 'integrations', 'backup', 'storage'],
  (select v from got where k = 'all') - array['bdm', 'integrations', 'backup', 'storage'],
  'the three parts together are the whole dashboard');
select is(public.dashboard_admin((select d from today), (select d from today), false, array['previous']) -> 'previous', 'null'::jsonb,
  'no comparison asked, none given');
select throws_ok($$ select public.dashboard_admin(current_date, current_date, true, array['everything']) $$, 'P0001', 'invalid_input',
  'an unknown part is refused');
select throws_ok($$ select public.dashboard_admin(current_date, current_date, true, '{}') $$, 'P0001', 'invalid_input',
  'asking for no part is refused');

------------------------------------------------------------------------------
-- Same answers as before
------------------------------------------------------------------------------
reset role;
select is((select v -> 'outstanding' from got where k = 'money'), pg_temp.old_outstanding(),
  'outstanding matches the reference query on all of this database''s bills');
select is((select jsonb_agg(x order by x ->> 'source_id') from jsonb_array_elements((select v -> 'by_source' from got where k = 'money')) x),
  pg_temp.old_by_source(private.ist_at((select d from today) - 29, '00:00'), private.ist_at((select d from today) + 1, '00:00')),
  'revenue by source matches the reference query');
select ok((select v -> 'outstanding' -> 'ageing' -> 0 ->> 'paise' from got where k = 'money')::bigint >= 70000,
  'the part-paid bill shows as owed today');
select ok((select v -> 'by_source' from got where k = 'money')
          @> '[{"source_id": "23232323-5555-4000-a000-000000000001", "paise": 100000, "patients": 1}]',
  'a patient''s own lead gives the source');
select ok((select v -> 'by_source' from got where k = 'money')
          @> '[{"source_id": "23232323-5555-4000-a000-000000000002", "paise": 50000, "patients": 1}]'
          and not (select v -> 'by_source' from got where k = 'money') @> '[{"source_id": "23232323-5555-4000-a000-000000000003"}]',
  'without one, the first lead converted into the patient gives the source');

select * from finish();
rollback;
