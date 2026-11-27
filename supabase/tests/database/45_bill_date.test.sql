-- The bill's date (owner, 27/11/2026): today's date when made, kept until Finalize, changeable to a
-- past or future day within a year; the number and FY follow the bill's date.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

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

insert into auth.users (id, email) values ('45454545-0000-4000-a000-0000000000b1', 'bd-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values ('45454545-0000-4000-a000-0000000000b1', 'receptionist', 'BD Rec', 'bdrec');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('45454545-1111-4000-a000-000000000001', 'BD-1', 'BD Patient', '+919811145451');
update public.app_settings set value = value || '{"round_to_rupee": false}' where section = 'billing';
create temp table k on commit drop as
  select (select id from public.lookup_values where kind = 'bill_category' and code = 'procedure') as cat,
         (now() at time zone 'Asia/Kolkata')::date as today;
grant select on k to authenticated;

create function pg_temp.lines()
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('description', 'Peel', 'category_id', (select cat from k), 'rate_paise', 100000,
                                              'qty', 1, 'discount_type', 'amount', 'discount_value', 0, 'gst_rate_bp', 0));
$$;
grant execute on function pg_temp.lines() to authenticated;
create function pg_temp.v(p_id uuid) returns integer language sql as $$ select version from public.bills where id = p_id $$;
create function pg_temp.d(p_id uuid) returns date language sql as $$ select (bill_at at time zone 'Asia/Kolkata')::date from public.bills where id = p_id $$;
grant execute on function pg_temp.v(uuid), pg_temp.d(uuid) to authenticated;

select pg_temp.login('45454545-0000-4000-a000-0000000000b1');

-- 1. Made today → today's date, even before Finalize.
select public.create_bill('procedure_receipt', '45454545-1111-4000-a000-000000000001', '{}', '45454545-2222-4000-a000-000000000001');
select is(pg_temp.d('45454545-2222-4000-a000-000000000001'), (select today from k), 'a new draft has today''s date');

-- 2. Made two days ago, saved and finalized today → still that day.
select pg_temp.login(null);
update public.bills set bill_at = bill_at - interval '2 days', created_at = created_at - interval '2 days'
 where id = '45454545-2222-4000-a000-000000000001';
select pg_temp.login('45454545-0000-4000-a000-0000000000b1');
select public.save_bill('45454545-2222-4000-a000-000000000001', '{}', pg_temp.lines(), pg_temp.v('45454545-2222-4000-a000-000000000001'));
select is(pg_temp.d('45454545-2222-4000-a000-000000000001'), (select today - 2 from k), 'opening and saving later keeps the date it was made');
select public.finalize_bill('45454545-2222-4000-a000-000000000001', pg_temp.v('45454545-2222-4000-a000-000000000001'));
select is(pg_temp.d('45454545-2222-4000-a000-000000000001'), (select today - 2 from k), 'finalizing keeps the bill''s date');
select is((select (finalized_at at time zone 'Asia/Kolkata')::date from public.bills where id = '45454545-2222-4000-a000-000000000001'),
  (select today from k), 'finalized_at still says when it was really finalized');

-- 3. Changed to another day: that day, same time of day; saving again without a date keeps it.
select public.create_bill('procedure_receipt', '45454545-1111-4000-a000-000000000001', '{}', '45454545-2222-4000-a000-000000000002');
create temp table t0 on commit drop as select (bill_at at time zone 'Asia/Kolkata')::time as tod from public.bills where id = '45454545-2222-4000-a000-000000000002';
select public.save_bill('45454545-2222-4000-a000-000000000002', jsonb_build_object('bill_date', (select today - 1 from k)),
  pg_temp.lines(), pg_temp.v('45454545-2222-4000-a000-000000000002'));
select is(pg_temp.d('45454545-2222-4000-a000-000000000002'), (select today - 1 from k), 'a past date is kept');
select is((select (bill_at at time zone 'Asia/Kolkata')::time from public.bills where id = '45454545-2222-4000-a000-000000000002'),
  (select tod from t0), 'the time of day stays');
select public.save_bill('45454545-2222-4000-a000-000000000002', '{}', pg_temp.lines(), pg_temp.v('45454545-2222-4000-a000-000000000002'));
select is(pg_temp.d('45454545-2222-4000-a000-000000000002'), (select today - 1 from k), 'saving again without a date doesn''t move it back to today');
select public.save_bill('45454545-2222-4000-a000-000000000002', jsonb_build_object('bill_date', (select today + 3 from k)),
  pg_temp.lines(), pg_temp.v('45454545-2222-4000-a000-000000000002'));
select public.finalize_bill('45454545-2222-4000-a000-000000000002', pg_temp.v('45454545-2222-4000-a000-000000000002'));
select is(pg_temp.d('45454545-2222-4000-a000-000000000002'), (select today + 3 from k), 'a future date is kept through Finalize');
select throws_ok($$ select public.save_bill('45454545-2222-4000-a000-000000000002', jsonb_build_object('bill_date', (select today from k)),
  pg_temp.lines(), pg_temp.v('45454545-2222-4000-a000-000000000002')) $$, 'P0001', 'bill_locked', 'a finalized bill''s date can''t be changed');

-- 4. Out of range or not a date.
select public.create_bill('procedure_receipt', '45454545-1111-4000-a000-000000000001', '{}', '45454545-2222-4000-a000-000000000003');
select throws_ok($$ select public.save_bill('45454545-2222-4000-a000-000000000003', jsonb_build_object('bill_date', (select today + 400 from k)),
  pg_temp.lines(), 1) $$, 'P0001', 'invalid_input', 'more than a year ahead is refused');
select throws_ok($$ select public.save_bill('45454545-2222-4000-a000-000000000003', jsonb_build_object('bill_date', (select today - 400 from k)),
  pg_temp.lines(), 1) $$, 'P0001', 'invalid_input', 'more than a year back is refused');
select throws_ok($$ select public.save_bill('45454545-2222-4000-a000-000000000003', '{"bill_date": "31/11/2026"}', pg_temp.lines(), 1) $$,
  'P0001', 'invalid_input', 'something that isn''t a date is refused');

-- 5. The number's FY follows the bill's date (a bill dated in the last financial year).
create temp table last_fy on commit drop as
  select (make_date(extract(year from today)::int - case when extract(month from today) >= 4 then 0 else 1 end, 4, 1) - 1) as day from k;
grant select on last_fy to authenticated;
select public.save_bill('45454545-2222-4000-a000-000000000003', jsonb_build_object('bill_date', (select day from last_fy)),
  pg_temp.lines(), 1);
select public.finalize_bill('45454545-2222-4000-a000-000000000003', pg_temp.v('45454545-2222-4000-a000-000000000003'));
select pg_temp.login(null);
select is((select fy from public.bills where id = '45454545-2222-4000-a000-000000000003'),
  private.fy_label(private.ist_at((select day from last_fy), '12:00')), 'a bill dated last year is numbered in last year''s series');
select isnt((select fy from public.bills where id = '45454545-2222-4000-a000-000000000003'),
  private.fy_label(now()), 'not this year''s');

select * from finish();
rollback;
