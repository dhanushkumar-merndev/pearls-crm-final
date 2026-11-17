-- Sales sheet (Phase 19c): leads_table's rows plus consultation, follow-up 1/2/3 and calls; a sales
-- executive sees only their own; lead_sheet_row for the phone.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

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

insert into auth.users (id, email) values
  ('37373737-0000-4000-a000-0000000000a1', 'sh-mgr@staff.invalid'),
  ('37373737-0000-4000-a000-0000000000c1', 'sh-s1@staff.invalid'),
  ('37373737-0000-4000-a000-0000000000c2', 'sh-s2@staff.invalid'),
  ('37373737-0000-4000-a000-0000000000b1', 'sh-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('37373737-0000-4000-a000-0000000000a1', 'sales_manager', 'Sh Manager', 'shmgr'),
  ('37373737-0000-4000-a000-0000000000c1', 'sales_executive', 'Sh Priya', 'shs1'),
  ('37373737-0000-4000-a000-0000000000c2', 'sales_executive', 'Sh Other', 'shs2'),
  ('37373737-0000-4000-a000-0000000000b1', 'receptionist', 'Sh Rec', 'shrec');
insert into public.doctors (id, full_name) values ('37373737-2222-4000-a000-000000000001', 'Dr Sheet');
insert into public.leads (id, name, phone_e164, assigned_to, doctor_id, amount_quoted_paise, surgery_date, comments1) values
  ('37373737-5555-4000-a000-000000000001', 'Sheet Lead One', '+919811437001', '37373737-0000-4000-a000-0000000000c1',
   '37373737-2222-4000-a000-000000000001', 9000000, '2026-12-01', 'wants EMI'),
  ('37373737-5555-4000-a000-000000000002', 'Sheet Lead Two', '+919811437002', '37373737-0000-4000-a000-0000000000c2', null, null, null, null);
-- Four calls: follow-up 1, 2, 3 are the first three, in order.
insert into public.call_logs (id, staff_id, lead_id, phone_e164, direction, started_at, duration_s, outcome, source) values
  (gen_random_uuid(), '37373737-0000-4000-a000-0000000000c1', '37373737-5555-4000-a000-000000000001', '+919811437001', 'outgoing', now() - interval '4 days', 0, 'no_answer', 'app'),
  (gen_random_uuid(), '37373737-0000-4000-a000-0000000000c1', '37373737-5555-4000-a000-000000000001', '+919811437001', 'outgoing', now() - interval '3 days', 60, 'connected', 'app'),
  (gen_random_uuid(), '37373737-0000-4000-a000-0000000000c1', '37373737-5555-4000-a000-000000000001', '+919811437001', 'outgoing', now() - interval '2 days', 0, 'busy', 'app'),
  (gen_random_uuid(), '37373737-0000-4000-a000-0000000000c1', '37373737-5555-4000-a000-000000000001', '+919811437001', 'outgoing', now() - interval '1 day', 90, 'call_back', 'app');
-- A past consultation and an upcoming one (the sheet shows the upcoming); a cancelled one is ignored.
insert into public.appointments (lead_id, doctor_id, appt_date, slot_start, slot_end, status) values
  ('37373737-5555-4000-a000-000000000001', '37373737-2222-4000-a000-000000000001', (now() - interval '5 days')::date,
   now() - interval '5 days', now() - interval '5 days' + interval '15 minutes', 'done'),
  ('37373737-5555-4000-a000-000000000001', '37373737-2222-4000-a000-000000000001', (now() + interval '2 days')::date,
   now() + interval '2 days', now() + interval '2 days' + interval '15 minutes', 'confirmed'),
  ('37373737-5555-4000-a000-000000000001', '37373737-2222-4000-a000-000000000001', (now() + interval '1 day')::date,
   now() + interval '1 day', now() + interval '1 day' + interval '15 minutes', 'cancelled');
create temp table want on commit drop as select
  (select slot_start from public.appointments where lead_id = '37373737-5555-4000-a000-000000000001' and status = 'confirmed') as upcoming;
grant select on want to authenticated;

select pg_temp.login('37373737-0000-4000-a000-0000000000a1');
create temp table m on commit drop as select public.leads_sheet('{"q": "Sheet Lead"}') as page;
select is(((select page from m) -> 'total')::int, 2, 'the manager sees every lead');
select is(jsonb_array_length((select page from m) -> 'rows'), 2, 'one row per lead');
create temp table one on commit drop as
  select r from m, jsonb_array_elements(page -> 'rows') r where r ->> 'name' = 'Sheet Lead One';
select is((select r #>> '{followups,0,outcome}' from one), 'no_answer', 'follow-up 1 = the first call');
select is((select r #>> '{followups,2,outcome}' from one), 'busy', 'follow-up 3 = the third call');
select is((select jsonb_array_length(r -> 'followups') from one), 3, 'only three follow-up columns');
select is((select (r ->> 'calls_total')::int from one), 4, 'the call count counts every call');
select is((select (r #>> '{consult,at}')::timestamptz from one), (select upcoming from want), 'consultation = the next booking (not the cancelled one)');
select is((select r #>> '{consult,doctor}' from one), 'Dr Sheet', 'with its doctor');
select is((select (r ->> 'amount_quoted_paise')::bigint from one), 9000000::bigint, 'the quotation (prescription column) is there');

select pg_temp.login('37373737-0000-4000-a000-0000000000c1');
select is(((public.leads_sheet('{"q": "Sheet Lead"}')) -> 'total')::int, 1, 'a sales executive sees only their own leads');
select is((public.lead_sheet_row('37373737-5555-4000-a000-000000000001')) ->> 'comments1', 'wants EMI', 'the phone row has the remarks');
select throws_ok($$ select public.lead_sheet_row('37373737-5555-4000-a000-000000000002') $$, 'P0001', 'not_found',
  'another executive''s lead is not shown');

select pg_temp.login('37373737-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.leads_sheet('{}') $$, 'P0001', 'not_allowed', 'reception has no sales sheet');

select * from finish();
rollback;
