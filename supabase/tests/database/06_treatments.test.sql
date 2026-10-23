-- Phase 4: treatments, session planning, re-planning, prices, appointment sync, follow-ups.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(30);

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
  ('77777777-0000-4000-a000-0000000000b1', 'p4-rec@staff.invalid'),
  ('77777777-0000-4000-a000-0000000000c1', 'p4-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('77777777-0000-4000-a000-0000000000b1', 'receptionist', 'P4 Rec', 'p4rec'),
  ('77777777-0000-4000-a000-0000000000c1', 'sales_executive', 'P4 Sales', 'p4sales');
insert into public.patients (id, uhid, full_name) values ('77777777-1111-4000-a000-000000000001', 'P4-1', 'P4 Patient');
insert into public.doctors (id, full_name, slot_minutes, capacity_override) values ('77777777-2222-4000-a000-00000000000a', 'Dr P4', 15, 3);
-- Every weekday 10:00–12:00 so any planned date can be booked.
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time)
select '77777777-2222-4000-a000-00000000000a', w, '10:00', '12:00' from generate_series(1, 7) w;
insert into public.treatment_templates (id, name, category, default_sessions, gap_days, default_price_paise, follow_up_days)
values ('77777777-3333-4000-a000-000000000001', 'P4 Laser 6', 'non_surgical', 6, '{0,30,60,90,120,150}', 2000000, 30);

select pg_temp.login('77777777-0000-4000-a000-0000000000b1');

------------------------------------------------------------------------------
-- Planning
------------------------------------------------------------------------------
create temp table t1 on commit drop as select public.start_treatment(
  '{"patient_id":"77777777-1111-4000-a000-000000000001","template_id":"77777777-3333-4000-a000-000000000001",
    "doctor_id":"77777777-2222-4000-a000-00000000000a","start_date":"2030-01-07"}',
  '77777777-4444-4000-a000-000000000001') as r;
grant select on t1 to authenticated;
select is((select jsonb_array_length(r -> 'sessions') from t1), 6, 'template defaults: 6 sessions');
select is((select r -> 'sessions' -> 5 ->> 'planned_date' from t1), '2030-06-06', 'session 6 = start + 150 days');
select is((select r ->> 'package_price_paise' from t1), '2000000', 'price from the template');
select is(
  (public.start_treatment('{"patient_id":"77777777-1111-4000-a000-000000000001"}', '77777777-4444-4000-a000-000000000001')) ->> 'id',
  '77777777-4444-4000-a000-000000000001', 'retrying with the same client id starts nothing new');
create temp table t2 on commit drop as select public.start_treatment(
  '{"patient_id":"77777777-1111-4000-a000-000000000001","name":"P4 PRP","sessions":4,"gap_days":[0,30],
    "start_date":"2030-01-07","price_paise":100000}',
  '77777777-4444-4000-a000-000000000002') as r;
grant select on t2 to authenticated;
select is((select jsonb_agg(s ->> 'planned_date') from t2, jsonb_array_elements(r -> 'sessions') s),
  '["2030-01-07", "2030-02-06", "2030-03-08", "2030-04-07"]'::jsonb,
  'past the last gap the last interval repeats: 0, 30, 60, 90');

------------------------------------------------------------------------------
-- Booking a session links it; the appointment drives the session
------------------------------------------------------------------------------
create temp table b2 on commit drop as select public.book_appointment(jsonb_build_object(
  'patient_id', '77777777-1111-4000-a000-000000000001', 'doctor_id', '77777777-2222-4000-a000-00000000000a',
  'slot_start', '2030-02-06 10:00+05:30', 'type', 'session',
  'treatment_id', '77777777-4444-4000-a000-000000000001',
  'session_id', (select r -> 'sessions' -> 1 ->> 'id' from t1)), gen_random_uuid()) as r;
grant select on b2 to authenticated;
select is((select status::text from public.treatment_sessions where id = (select (r ->> 'session_id')::uuid from b2)), 'booked',
  'booking a session marks it booked');
select lives_ok($$ select public.reschedule_appointment((select (r ->> 'id')::uuid from b2), '2030-02-06 10:15+05:30', null, 'moved') $$,
  'reschedule the session''s booking');
select isnt(
  (select appointment_id from public.treatment_sessions where id = (select (r ->> 'session_id')::uuid from b2)),
  (select (r ->> 'id')::uuid from b2), 'the session follows the new booking');
select is((select status::text from public.treatment_sessions where id = (select (r ->> 'session_id')::uuid from b2)), 'booked',
  'and stays booked');
select lives_ok($$ select public.set_appointment_status(
  (select appointment_id from public.treatment_sessions where id = (select (r ->> 'session_id')::uuid from b2)), 'cancelled', 'patient travelling') $$,
  'cancel the session''s booking');
select is((select status::text from public.treatment_sessions where id = (select (r ->> 'session_id')::uuid from b2)), 'planned',
  'a cancelled booking puts the session back to planned');

------------------------------------------------------------------------------
-- Re-planning touches only future planned sessions
------------------------------------------------------------------------------
select lives_ok($$ select public.set_session_status((select (r -> 'sessions' -> 0 ->> 'id')::uuid from t1), 'done') $$, 'session 1 done');
select lives_ok($$ select public.book_appointment(jsonb_build_object(
  'patient_id', '77777777-1111-4000-a000-000000000001', 'doctor_id', '77777777-2222-4000-a000-00000000000a',
  'slot_start', '2030-02-06 10:30+05:30', 'session_id', (select r -> 'sessions' -> 1 ->> 'id' from t1)), gen_random_uuid()) $$,
  'session 2 booked');
select lives_ok($$ select public.update_treatment('77777777-4444-4000-a000-000000000001', '{"gap_days":[0,14,28,42,56,70]}',
  (select version from public.patient_treatments where id = '77777777-4444-4000-a000-000000000001')) $$,
  'change the gaps');
select is(
  (select jsonb_agg(jsonb_build_array(s.seq, s.status, s.planned_date) order by s.seq)
     from public.treatment_sessions s where s.treatment_id = '77777777-4444-4000-a000-000000000001'),
  '[[1,"done","2030-01-07"],[2,"booked","2030-02-06"],[3,"planned","2030-02-04"],[4,"planned","2030-02-18"],[5,"planned","2030-03-04"],[6,"planned","2030-03-18"]]'::jsonb,
  'done and booked sessions keep their dates; only future planned ones move');
select is(
  (select jsonb_agg(planned_date order by seq) from public.treatment_sessions where treatment_id = '77777777-4444-4000-a000-000000000002'),
  '["2030-01-07", "2030-02-06", "2030-03-08", "2030-04-07"]'::jsonb,
  'the other treatment of the same patient is untouched');

------------------------------------------------------------------------------
-- Prices need a reason and are audited
------------------------------------------------------------------------------
select throws_ok($$ select public.update_treatment('77777777-4444-4000-a000-000000000001', '{"price_paise":1800000}',
  (select version from public.patient_treatments where id = '77777777-4444-4000-a000-000000000001')) $$,
  'P0001', 'reason_required', 'a price change without a reason is refused');
select lives_ok($$ select public.update_treatment('77777777-4444-4000-a000-000000000001', '{"price_paise":1800000}',
  (select version from public.patient_treatments where id = '77777777-4444-4000-a000-000000000001'), 'loyalty discount') $$,
  'with a reason it saves');
select pg_temp.login(null);
select is(
  (select reason from public.audit_log where table_name = 'patient_treatments' and row_id = '77777777-4444-4000-a000-000000000001'
     and changes ? 'package_price_paise' order by id desc limit 1),
  'loyalty discount', 'the audit log keeps the price change and its reason');
select pg_temp.login('77777777-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.update_treatment('77777777-4444-4000-a000-000000000001', '{"name":"x"}', 1) $$,
  'P0001', 'stale_version', 'an edit on an old copy is refused');

------------------------------------------------------------------------------
-- Done / missed / remove; book next; completion + follow-up
------------------------------------------------------------------------------
select throws_ok($$ select public.remove_session((select (r -> 'sessions' -> 2 ->> 'id')::uuid from t1), 'x') $$,
  'P0001', 'reason_required', 'removing a session needs a reason');
select throws_ok($$ select public.remove_session((select (r -> 'sessions' -> 1 ->> 'id')::uuid from t1), 'not needed') $$,
  'P0001', 'invalid_status_change', 'a booked session can''t be removed (cancel the booking first)');
select is(
  (public.set_session_status((select (r -> 'sessions' -> 0 ->> 'id')::uuid from t2), 'done')) -> 'book_next' ->> 'seq',
  '2', 'after a session, "book next?" offers the next one');
select lives_ok($$ select public.remove_session((select (r -> 'sessions' -> 3 ->> 'id')::uuid from t2), 'patient happy after 3') $$,
  'remove the last session');
select is((select status::text from public.treatment_sessions where id = (select (r -> 'sessions' -> 3 ->> 'id')::uuid from t2)), 'skipped',
  'a removed session stays in the history as skipped');
select lives_ok($$ select public.set_session_status((select (r -> 'sessions' -> 1 ->> 'id')::uuid from t2), 'done') $$, 'session 2 done');
select is(
  (public.set_session_status((select (r -> 'sessions' -> 2 ->> 'id')::uuid from t2), 'done')) -> 'treatment' ->> 'status',
  'completed', 'the last open session completes the treatment');
select is((select jsonb_array_length(public.sessions_due('2030-01-01', '2030-12-31') -> 'items')), 4,
  'sessions due: the 4 planned sessions of the laser plan');

------------------------------------------------------------------------------
-- Roles
------------------------------------------------------------------------------
select pg_temp.login('77777777-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.patient_treatments), 0, 'sales cannot read treatments');
select throws_ok($$ select public.patient_treatments_list('77777777-1111-4000-a000-000000000001') $$,
  'P0001', 'not_allowed', 'nor list them');

select * from finish();
rollback;
