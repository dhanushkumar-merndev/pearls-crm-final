-- Phase 3: slots, capacity, blocked days, IST boundaries, status flow, walk-ins, tasks.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(43);

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
  ('66666666-0000-4000-a000-00000000000a', 'p3-admin@staff.invalid'),
  ('66666666-0000-4000-a000-0000000000b1', 'p3-rec@staff.invalid'),
  ('66666666-0000-4000-a000-0000000000c1', 'p3-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('66666666-0000-4000-a000-00000000000a', 'admin', 'P3 Admin', 'p3admin'),
  ('66666666-0000-4000-a000-0000000000b1', 'receptionist', 'P3 Rec', 'p3rec'),
  ('66666666-0000-4000-a000-0000000000c1', 'sales_executive', 'P3 Sales', 'p3sales');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('66666666-1111-4000-a000-000000000001', 'P3-1', 'P3 Patient One', '+919800000001'),
  ('66666666-1111-4000-a000-000000000002', 'P3-2', 'P3 Patient Two', '+919800000002'),
  ('66666666-1111-4000-a000-000000000003', 'P3-3', 'P3 Patient Three', '+919800000003'),
  ('66666666-1111-4000-a000-000000000004', 'P3-4', 'P3 Patient Four', '+919800000004');
-- Doctor A: Monday 10:00–11:00 (15-min slots, 3 per slot) and Monday 00:00–00:30 (for the IST midnight test).
-- Doctor B: Monday 10:00–10:50 with 15-min slots and ONE patient per slot.
insert into public.doctors (id, full_name, slot_minutes, capacity_override) values
  ('66666666-2222-4000-a000-00000000000a', 'Dr P3 A', 15, 3),
  ('66666666-2222-4000-a000-00000000000b', 'Dr P3 B', 15, 1);
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time) values
  ('66666666-2222-4000-a000-00000000000a', 1, '10:00', '11:00'),
  ('66666666-2222-4000-a000-00000000000a', 1, '00:00', '00:30'),
  ('66666666-2222-4000-a000-00000000000b', 1, '10:00', '10:50');
-- 2030-01-07 and 2030-01-14 are Mondays.

------------------------------------------------------------------------------
-- Slots and capacity
------------------------------------------------------------------------------
select pg_temp.login('66666666-0000-4000-a000-0000000000b1');
select is(jsonb_array_length(public.get_free_slots('66666666-2222-4000-a000-00000000000a', '2030-01-07')), 6,
  'Monday: 4 slots from 10:00–11:00 + 2 from 00:00–00:30');
select is(jsonb_array_length(public.get_free_slots('66666666-2222-4000-a000-00000000000b', '2030-01-07')), 3,
  '10:00–10:50 in 15-minute slots = 3 whole slots (never one past closing)');
select is(jsonb_array_length(public.get_free_slots('66666666-2222-4000-a000-00000000000a', '2030-01-08')), 0,
  'no hours on Tuesday → no slots');

create function pg_temp.book(p_patient text, p_doctor text, p_at text)
returns jsonb language sql as $$
  select public.book_appointment(jsonb_build_object('patient_id', p_patient, 'doctor_id', p_doctor, 'slot_start', p_at),
                                 gen_random_uuid());
$$;
grant execute on function pg_temp.book(text, text, text) to authenticated;

select lives_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000001', '66666666-2222-4000-a000-00000000000a', '2030-01-07 10:00+05:30') $$, 'booking 1 of 3');
select lives_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000002', '66666666-2222-4000-a000-00000000000a', '2030-01-07 10:00+05:30') $$, 'booking 2 of 3');
select lives_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000003', '66666666-2222-4000-a000-00000000000a', '2030-01-07 10:00+05:30') $$, 'booking 3 of 3');
select throws_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000004', '66666666-2222-4000-a000-00000000000a', '2030-01-07 10:00+05:30') $$,
  'P0001', 'slot_full', 'a 4th booking in a 3-place slot is refused');
select is((public.get_free_slots('66666666-2222-4000-a000-00000000000a', '2030-01-07') -> 2 ->> 'left'), '0', 'the slot shows 0 left');
select lives_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000001', '66666666-2222-4000-a000-00000000000b', '2030-01-07 10:00+05:30') $$, 'doctor B: 1 of 1');
select throws_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000002', '66666666-2222-4000-a000-00000000000b', '2030-01-07 10:00+05:30') $$,
  'P0001', 'slot_full', 'per-doctor capacity (1) is respected');
select is(
  public.book_appointment('{"patient_id":"66666666-1111-4000-a000-000000000004","doctor_id":"66666666-2222-4000-a000-00000000000a","slot_start":"2030-01-07 10:15+05:30"}',
                          '66666666-3333-4000-a000-000000000001') ->> 'repeat', 'false', 'booking with a client id');
select is(
  public.book_appointment('{"patient_id":"66666666-1111-4000-a000-000000000004","doctor_id":"66666666-2222-4000-a000-00000000000a","slot_start":"2030-01-07 10:15+05:30"}',
                          '66666666-3333-4000-a000-000000000001') ->> 'repeat', 'true', 'a retry with the same client id books nothing new');

------------------------------------------------------------------------------
-- Blocked times
------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000001', '66666666-2222-4000-a000-00000000000a', '2030-01-07 10:07+05:30') $$,
  'P0001', 'outside_schedule', 'a time that is not a slot start is refused');
select throws_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000001', '66666666-2222-4000-a000-00000000000a', '2030-01-07 11:00+05:30') $$,
  'P0001', 'outside_schedule', 'closing time is not a slot');
select throws_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000001', '66666666-2222-4000-a000-00000000000a', '2020-01-06 10:00+05:30') $$,
  'P0001', 'slot_in_past', 'the past can''t be booked');
select pg_temp.login(null);
insert into public.holidays (day, name) values ('2030-01-14', 'P3 holiday');
insert into public.doctor_leaves (doctor_id, during) values
  ('66666666-2222-4000-a000-00000000000b', tstzrange('2030-01-21 00:00+05:30', '2030-01-22 00:00+05:30'));
select pg_temp.login('66666666-0000-4000-a000-0000000000b1');
select throws_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000001', '66666666-2222-4000-a000-00000000000a', '2030-01-14 10:00+05:30') $$,
  'P0001', 'holiday', 'holidays are blocked');
select throws_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000001', '66666666-2222-4000-a000-00000000000b', '2030-01-21 10:00+05:30') $$,
  'P0001', 'doctor_on_leave', 'doctor leave is blocked');
select is((public.get_free_slots('66666666-2222-4000-a000-00000000000a', '2030-01-14') -> 0 ->> 'blocked_reason'), 'holiday',
  'free slots say why they are blocked');

------------------------------------------------------------------------------
-- IST day boundary: 00:00 IST Monday is still Sunday in UTC
------------------------------------------------------------------------------
select is(
  (pg_temp.book('66666666-1111-4000-a000-000000000002', '66666666-2222-4000-a000-00000000000a', '2030-01-07 00:00+05:30') ->> 'appt_date'),
  '2030-01-07', '00:00 IST belongs to the IST date, not the UTC date (2030-01-06)');
select is(
  (select count(*)::int from public.appointments where appt_date = '2030-01-06'
     and doctor_id = '66666666-2222-4000-a000-00000000000a'), 0,
  'nothing was filed under the UTC day');

------------------------------------------------------------------------------
-- Status flow
------------------------------------------------------------------------------
select throws_ok($$ select public.set_appointment_status('66666666-3333-4000-a000-000000000001', 'done') $$,
  'P0001', 'invalid_status_change', 'pending → done is not allowed');
select throws_ok($$ select public.set_appointment_status('66666666-3333-4000-a000-000000000001', 'cancelled') $$,
  'P0001', 'invalid_input', 'cancelling needs a reason');
select is(public.set_appointment_status('66666666-3333-4000-a000-000000000001', 'confirmed') ->> 'confirmed_via', 'reception', 'confirmed by reception');
select is(public.set_appointment_status('66666666-3333-4000-a000-000000000001', 'arrived') ->> 'status', 'arrived', 'arrived');
select is((select count(*)::int from public.visits where appointment_id = '66666666-3333-4000-a000-000000000001'), 1, 'arrival opens a visit');
select lives_ok($$ select public.set_appointment_status('66666666-3333-4000-a000-000000000001', 'with_doctor') $$, 'with the doctor');
select lives_ok($$ select public.set_appointment_status('66666666-3333-4000-a000-000000000001', 'done') $$, 'done');
select ok((select check_out_at is not null from public.visits where appointment_id = '66666666-3333-4000-a000-000000000001'),
  'done closes the visit');
select throws_ok($$ select public.set_appointment_status('66666666-3333-4000-a000-000000000001', 'confirmed') $$,
  'P0001', 'invalid_status_change', 'a finished appointment stays finished');

------------------------------------------------------------------------------
-- Reschedule frees the old place
------------------------------------------------------------------------------
create temp table moved on commit drop as
  select public.reschedule_appointment(
    (select id from public.appointments where patient_id = '66666666-1111-4000-a000-000000000003'
       and slot_start = '2030-01-07 10:00+05:30'),
    '2030-01-07 10:30+05:30', null, 'patient asked') as r;
grant select on moved to authenticated;
select is((select r ->> 'status' from moved), 'pending_confirmation', 'the new booking waits for confirmation');
select is((public.get_free_slots('66666666-2222-4000-a000-00000000000a', '2030-01-07') -> 2 ->> 'left'), '1',
  'the old slot has a place again');

------------------------------------------------------------------------------
-- Walk-ins: no slot running now (it's 2030 in the fixtures) → queue
------------------------------------------------------------------------------
select is((public.book_walk_in('66666666-1111-4000-a000-000000000004', null, null, gen_random_uuid())) ->> 'queue_no', '1',
  'first walk-in without a free slot gets queue number 1');
select is((public.book_walk_in('66666666-1111-4000-a000-000000000003', null, null, gen_random_uuid())) ->> 'queue_no', '2',
  'the next gets 2');

------------------------------------------------------------------------------
-- Tables, boards, dashboard
------------------------------------------------------------------------------
select is((public.appointments_table('{"from":"2030-01-07","to":"2030-01-07"}') ->> 'total')::int, 7,
  'appointments table counts the day (rescheduled kept as history)');
select is(jsonb_array_length(public.appointments_table('{"from":"2030-01-07","statuses":["pending_confirmation"]}', 'patient', false, 0, 2) -> 'rows'), 2,
  'filters + page size');
select throws_ok($$ select public.appointments_table('{"from":"2020-01-01","to":"2030-01-01"}') $$,
  'P0001', 'invalid_input', 'a range wider than a year is refused (cost must not grow with the range)');
select is((public.today_board('2030-01-07') -> 'counts' ->> 'done')::int, 1, 'Today board counts done');
select is(jsonb_array_length(public.dashboard_reception('2030-01-07') -> 'arrivals_by_hour'), 15, 'arrivals by hour 07–21');
select is((select jsonb_array_length(d -> 'slots') from jsonb_array_elements(public.slot_board('2030-01-07') -> 'doctors') d
             where d ->> 'name' = 'Dr P3 B'), 3, 'slot board lists each doctor''s slots');

------------------------------------------------------------------------------
-- "Call to confirm" tasks: once per booking
------------------------------------------------------------------------------
select pg_temp.login(null);
update public.app_settings set value = value || '{"confirm_hours_before": 100000}' where section = 'appointments';
insert into public.app_settings (section, value) values ('appointments', '{"confirm_hours_before": 100000}')
  on conflict (section) do nothing;
select ok(private.appointment_confirm_tasks() >= 4, 'tasks for bookings still not confirmed');
select is(private.appointment_confirm_tasks(), 0, 'running again adds no duplicates');

------------------------------------------------------------------------------
-- Roles
------------------------------------------------------------------------------
select pg_temp.login('66666666-0000-4000-a000-0000000000c1');
select throws_ok($$ select pg_temp.book('66666666-1111-4000-a000-000000000001', '66666666-2222-4000-a000-00000000000a', '2030-01-07 10:45+05:30') $$,
  'P0001', 'not_allowed', 'sales book leads, not patients');
select is((select count(*)::int from public.appointments), 0, 'sales cannot read appointments directly');

select * from finish();
rollback;
