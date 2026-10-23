-- Phase 1: doctors, schedules, leaves, libraries, pickers, review, merge, audit viewer.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(38);

-- Acts as a staff member (or, with null, as the database owner) for the next statements.
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
  ('44444444-0000-4000-a000-00000000000a', 'p1-admin@test.local'),
  ('44444444-0000-4000-a000-0000000000b1', 'p1-rec@test.local'),
  ('44444444-0000-4000-a000-0000000000c1', 'p1-sales@test.local'),
  ('44444444-0000-4000-a000-0000000000d1', 'p1-bdm@test.local');
insert into public.staff (id, role, full_name) values
  ('44444444-0000-4000-a000-00000000000a', 'admin', 'P1 Admin'),
  ('44444444-0000-4000-a000-0000000000b1', 'receptionist', 'P1 Rec'),
  ('44444444-0000-4000-a000-0000000000c1', 'sales_executive', 'P1 Sales'),
  ('44444444-0000-4000-a000-0000000000d1', 'bdm', 'P1 Bdm');

------------------------------------------------------------------------------
-- Doctors and schedules (admin writes directly under RLS)
------------------------------------------------------------------------------
select pg_temp.login('44444444-0000-4000-a000-00000000000a');
insert into public.doctors (id, full_name, specialization) values
  ('44444444-1111-4000-a000-000000000001', 'Dr P1 One', 'Dermatology');
select lives_ok($$
  insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time)
  values ('44444444-1111-4000-a000-000000000001', 1, '10:00', '13:00') $$,
  'admin adds Monday 10:00–13:00');
select throws_ok($$
  insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time)
  values ('44444444-1111-4000-a000-000000000001', 1, '12:00', '14:00') $$,
  '23P01', null, 'overlapping hours on the same weekday are refused');
select lives_ok($$
  insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time)
  values ('44444444-1111-4000-a000-000000000001', 1, '13:00', '17:00') $$,
  'back-to-back hours are fine (13:00 end, 13:00 start)');
select throws_ok($$
  insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, valid_from, valid_to)
  values ('44444444-1111-4000-a000-000000000001', 3, '10:00', '13:00', '2000-01-01', '1999-12-31') $$,
  '23514', null, 'validity ending before it starts is refused');
select throws_ok($$
  insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time)
  values ('44444444-1111-4000-a000-000000000001', 2, '15:00', '11:00') $$,
  '23514', null, 'end before start is refused');
select lives_ok($$
  insert into public.doctor_leaves (doctor_id, during, reason)
  values ('44444444-1111-4000-a000-000000000001', tstzrange('2030-01-10 00:00+05:30', '2030-01-12 00:00+05:30'), 'conference') $$,
  'admin adds a leave');
select throws_ok($$
  insert into public.doctor_leaves (doctor_id, during)
  values ('44444444-1111-4000-a000-000000000001', tstzrange('2030-01-11 00:00+05:30', '2030-01-13 00:00+05:30')) $$,
  '23P01', null, 'overlapping leaves are refused');

------------------------------------------------------------------------------
-- Receptionists cannot change settings or master data directly
------------------------------------------------------------------------------
select pg_temp.login('44444444-0000-4000-a000-0000000000b1');
select ok((select count(*) from public.doctors where id = '44444444-1111-4000-a000-000000000001') = 1,
  'receptionist reads doctors');
select throws_ok($$ insert into public.doctors (full_name) values ('Dr Sneaky') $$,
  '42501', null, 'receptionist cannot add doctors directly');
select throws_ok($$ select public.update_settings('appointments', '{"capacity_per_slot": 99}', 1) $$,
  'P0001', 'not_allowed', 'receptionist cannot change settings (direct API call)');
select throws_ok($$ update public.app_settings set value = '{}' where section = 'appointments' $$,
  '42501', null, 'receptionist cannot update settings rows directly');
select pg_temp.login(null);
select isnt((select value ->> 'capacity_per_slot' from public.app_settings where section = 'appointments'), null,
  'settings are unchanged');
select pg_temp.login('44444444-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.save_clinic_profile('{"name":"Hacked"}') $$,
  'P0001', 'not_allowed', 'receptionist cannot save the clinic profile');
select throws_ok($$ select public.audit_list() $$, 'P0001', 'not_allowed', 'receptionist cannot read the audit log');

------------------------------------------------------------------------------
-- Library picker: 10 most used first, server search, "load 10 more"
------------------------------------------------------------------------------
select pg_temp.login(null);
insert into public.services (name, usage_count)
select format('P1 Service %s', lpad(n::text, 2, '0')), n from generate_series(1, 25) n;
insert into public.services (name, usage_count) values ('P1 Laser Toning', 0), ('P1 Hair Laser', 3);
-- Hide every non-fixture service so the counts below are exact.
update public.services set active = false where name not like 'P1 %';

select pg_temp.login('44444444-0000-4000-a000-0000000000b1');
create temp table page1 on commit drop as select public.library_search('service', '', null, 10) as r;
select is(jsonb_array_length((select r -> 'items' from page1)), 10, 'first page has 10 items');
select is((select r -> 'items' -> 0 ->> 'label' from page1), 'P1 Service 25', 'most used comes first');
select isnt((select r ->> 'next_cursor' from page1), null, 'there are more to load');
create temp table page2 on commit drop as
  select public.library_search('service', '', (select r ->> 'next_cursor' from page1), 10) as r;
select is((select r -> 'items' -> 0 ->> 'label' from page2), 'P1 Service 15', 'load more continues where page 1 stopped');
create temp table page3 on commit drop as
  select public.library_search('service', '', (select r ->> 'next_cursor' from page2), 10) as r;
select is(jsonb_array_length((select r -> 'items' from page3)), 7, 'last page has the remaining 7');
select is((select r -> 'next_cursor' from page3), 'null'::jsonb, 'no cursor after the last page');
select is(
  (select count(distinct x ->> 'id')::int from (
     select jsonb_array_elements(r -> 'items') x from page1 union all
     select jsonb_array_elements(r -> 'items') from page2 union all
     select jsonb_array_elements(r -> 'items') from page3) all_items),
  27, 'all 27 items, each exactly once');
select is(
  (select public.library_search('service', 'laser') -> 'items' -> 0 ->> 'label'), 'P1 Hair Laser',
  'search matches inside names, most used first');
select is(
  (select jsonb_array_length(public.library_search('service', 'p1 l') -> 'items')), 1,
  'search narrows on the server');
select is(
  (select public.library_search('service', '%') -> 'items'), '[]'::jsonb,
  'wildcards in search text are taken literally');

------------------------------------------------------------------------------
-- Adding on the fly
------------------------------------------------------------------------------
create temp table created on commit drop as
  select public.library_create('service', '{"label":"P1 Hydrafacial","price_paise":250000}',
                               '44444444-2222-4000-a000-000000000001') as r;
select ok((select (r ->> 'on_the_fly')::boolean from created), 'a receptionist''s new item is flagged for review');
select is((select r -> 'defaults' ->> 'price_paise' from created), '250000', 'its price is kept');
select is(
  public.library_create('service', '{"label":"P1 Hydrafacial"}', '44444444-2222-4000-a000-000000000001') ->> 'id',
  '44444444-2222-4000-a000-000000000001', 'retrying with the same client id returns the same item');
select is(
  public.library_create('service', '{"label":"p1 hydrafacial"}', gen_random_uuid()) ->> 'id',
  '44444444-2222-4000-a000-000000000001', 'the same name (any case) returns the existing item');

select pg_temp.login('44444444-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.library_create('service', '{"label":"x"}', gen_random_uuid()) $$,
  'P0001', 'not_allowed', 'sales cannot add services');
select ok((public.library_create('lead_source', '{"label":"P1 Newspaper"}', gen_random_uuid()) ->> 'on_the_fly')::boolean,
  'sales can add a lead source on the fly');
select pg_temp.login('44444444-0000-4000-a000-0000000000d1');
select throws_ok($$ select public.library_search('service', '') $$, 'P0001', 'not_allowed', 'BDMs cannot search services');

------------------------------------------------------------------------------
-- Admin review and merge
------------------------------------------------------------------------------
select pg_temp.login('44444444-0000-4000-a000-00000000000a');
select ok(
  exists (select 1 from jsonb_array_elements(public.library_review_list('service') -> 'items') x
          where x ->> 'id' = '44444444-2222-4000-a000-000000000001'),
  'the new item is in "New items to review"');
insert into public.treatment_templates (id, name) values ('44444444-3333-4000-a000-000000000001', 'P1 Facial plan');
insert into public.treatment_template_services (template_id, service_id)
  values ('44444444-3333-4000-a000-000000000001', '44444444-2222-4000-a000-000000000001');
create temp table keep_svc on commit drop as
  select id from public.services where name = 'P1 Laser Toning';
select is(
  public.library_merge('service', '44444444-2222-4000-a000-000000000001', (select id from keep_svc))
    -> 'moved' ->> 'public.treatment_template_services.service_id',
  '1', 'merge reports moved rows per table.column');
select is(
  (select service_id from public.treatment_template_services where template_id = '44444444-3333-4000-a000-000000000001'),
  (select id from keep_svc), 'merge repoints every reference to the kept item');
select ok(
  (select not active and merged_into_id = (select id from keep_svc) from public.services
    where id = '44444444-2222-4000-a000-000000000001'),
  'the duplicate is retired and points at the kept item');
select ok(
  (select count(*) from jsonb_array_elements(public.audit_list('services') -> 'items')) > 0,
  'admin sees service changes in the audit viewer');

select pg_temp.login(null);
insert into auth.users (id, email) values ('44444444-0000-4000-a000-0000000000e1', 'p1-new@staff.invalid');
select pg_temp.login('44444444-0000-4000-a000-00000000000a');
select throws_ok($$ select public.admin_create_staff('44444444-0000-4000-a000-0000000000e1', 'receptionist', 'No Username') $$,
  'P0001', 'invalid_input', 'every login needs a username');
select is(
  (public.admin_create_staff('44444444-0000-4000-a000-0000000000e1', 'receptionist', 'New Rec', ' New.Rec ')).username,
  'new.rec', 'usernames are stored trimmed and lower-case');

select * from finish();
rollback;
