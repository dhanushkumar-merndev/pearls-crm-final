-- Auto-cancel of bookings nobody confirmed (default 12 h before), the alerts, Restore & confirm,
-- "keep cancelled", YES on WhatsApp, the setting switched off, and the phone's alerts list.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
-- Whole UTC hours are IST half hours: always on the test doctor's 15-minute grid.
set local timezone = 'UTC';

select plan(38);

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
  ('27272727-0000-4000-a000-00000000000a', 'ac-admin@staff.invalid'),
  ('27272727-0000-4000-a000-0000000000b1', 'ac-rec@staff.invalid'),
  ('27272727-0000-4000-a000-0000000000c1', 'ac-sales@staff.invalid'),
  ('27272727-0000-4000-a000-0000000000c2', 'ac-sales2@staff.invalid'),
  ('27272727-0000-4000-a000-0000000000d1', 'ac-manager@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('27272727-0000-4000-a000-00000000000a', 'admin', 'AC Admin', 'acadmin'),
  ('27272727-0000-4000-a000-0000000000b1', 'receptionist', 'AC Rec', 'acrec'),
  ('27272727-0000-4000-a000-0000000000c1', 'sales_executive', 'AC Sales', 'acsales'),
  ('27272727-0000-4000-a000-0000000000c2', 'sales_executive', 'AC Sales Two', 'acsales2'),
  ('27272727-0000-4000-a000-0000000000d1', 'sales_manager', 'AC Manager', 'acmanager');

insert into public.patients (id, uhid, full_name, phone_e164)
select ('27272727-1111-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'ACTEST-' || n, 'AC Patient ' || n,
       '+9198114270' || lpad(n::text, 2, '0')
from generate_series(1, 10) n;
insert into public.leads (id, name, phone_e164, assigned_to, patient_id) values
  ('27272727-2222-4000-a000-000000000001', 'AC Lead One', '+919811427101', '27272727-0000-4000-a000-0000000000c1',
   '27272727-1111-4000-a000-000000000001');
-- One patient per slot, open round the clock every day; no holiday in the way.
insert into public.doctors (id, full_name, slot_minutes, capacity_override) values
  ('27272727-3333-4000-a000-000000000001', 'Dr AC Test', 15, 1);
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time)
select '27272727-3333-4000-a000-000000000001', d, '00:00', '23:59' from generate_series(1, 7) d;
delete from public.holidays where day between current_date - 1 and current_date + 2;
insert into public.app_settings (section, value) values ('appointments', '{"auto_cancel_hours_before": 12}')
on conflict (section) do update set value = public.app_settings.value || excluded.value;

create function pg_temp.at(p_hours integer)
returns timestamptz language sql as $$ select date_trunc('hour', now()) + make_interval(hours => p_hours) $$;
-- A booking p_hours from now, made p_booked ago.
create function pg_temp.appt(p_id text, p_patient integer, p_hours integer, p_status text default 'pending_confirmation',
                             p_booked interval default '2 days', p_walk_in boolean default false, p_lead uuid default null)
returns void language sql as $$
  insert into public.appointments (id, patient_id, lead_id, doctor_id, appt_date, slot_start, slot_end, status, is_walk_in, created_at)
  values (('27272727-4444-4000-a000-0000000000' || p_id)::uuid,
          ('27272727-1111-4000-a000-0000000000' || lpad(p_patient::text, 2, '0'))::uuid, p_lead,
          '27272727-3333-4000-a000-000000000001', (private.ist(pg_temp.at(p_hours)))::date,
          pg_temp.at(p_hours), pg_temp.at(p_hours) + interval '15 minutes', p_status::public.appt_status, p_walk_in, now() - p_booked);
$$;
-- Its WhatsApp reminder, p_ago ago.
create function pg_temp.reminder(p_id text, p_status text default 'delivered', p_ago interval default '3 hours')
returns void language sql as $$
  insert into public.wa_messages (phone_e164, direction, kind, status, status_rank, purpose, dedupe_key, appointment_id,
                                  created_at, scheduled_for)
  values ('+919811427999', 'outbound', 'template', p_status::public.wa_status, 2, 'appointment_reminder',
          'reminder:27272727-4444-4000-a000-0000000000' || p_id, ('27272727-4444-4000-a000-0000000000' || p_id)::uuid,
          now() - p_ago, now() - p_ago);
$$;
create function pg_temp.a(p_id text) returns uuid language sql as $$ select ('27272727-4444-4000-a000-0000000000' || p_id)::uuid $$;
grant execute on function pg_temp.a(text) to authenticated;

select pg_temp.appt('01', 1, 6, p_lead => '27272727-2222-4000-a000-000000000001'); select pg_temp.reminder('01');
select pg_temp.appt('02', 2, 7);                                   -- no reminder
select pg_temp.appt('03', 3, 8, p_booked => '1 hour');             select pg_temp.reminder('03');  -- booked inside the window
select pg_temp.appt('04', 4, 9, p_walk_in => true);                select pg_temp.reminder('04');  -- walk-in
select pg_temp.appt('05', 5, 10);                                  select pg_temp.reminder('05', p_ago => '1 hour');
select pg_temp.appt('06', 6, 11);                                  select pg_temp.reminder('06', 'failed');
select pg_temp.appt('07', 7, 14);                                  select pg_temp.reminder('07');  -- not within 12 h yet
select pg_temp.appt('08', 8, 5, 'confirmed');                      select pg_temp.reminder('08');

------------------------------------------------------------------------------
-- The timer
------------------------------------------------------------------------------
select is(private.appointment_auto_cancel(), 1, 'one booking is auto-cancelled');
select is((select status::text || ' / ' || cancel_reason from public.appointments where id = pg_temp.a('01')),
  'cancelled / Not confirmed (auto)', 'it is cancelled as "Not confirmed (auto)"');
select isnt((select auto_cancelled_at from public.appointments where id = pg_temp.a('01')), null, 'and marked auto-cancelled');
select is((select count(*)::int from public.appointments where id in (pg_temp.a('02'), pg_temp.a('03'), pg_temp.a('04'),
            pg_temp.a('05'), pg_temp.a('06'), pg_temp.a('07')) and status = 'pending_confirmation'), 6,
  'left alone: no reminder, booked inside the window, walk-in, reminder < 2 h ago, reminder failed, more than 12 h away');
select is(private.appointment_auto_cancel(), 0, 'running again cancels nothing more');
select is((select count(*)::int from public.followups where kind = 'call_to_confirm' and ref_id = pg_temp.a('01') and status = 'open'), 1,
  'one "call to confirm" task');

------------------------------------------------------------------------------
-- Who is told
------------------------------------------------------------------------------
select is((select array_agg(recipient_id order by recipient_id) from public.notifications
           where dedupe_key like 'appt_cancelled:' || pg_temp.a('01') || ':%'
             and recipient_id::text like '27272727-0000-%'),
  array['27272727-0000-4000-a000-00000000000a', '27272727-0000-4000-a000-0000000000b1', '27272727-0000-4000-a000-0000000000c1']::uuid[],
  'admin, receptionist and the lead''s salesperson are alerted (not another salesperson, not the manager)');
select is((select link from public.notifications where recipient_id = '27272727-0000-4000-a000-0000000000c1'
             and dedupe_key like 'appt_cancelled:%'), '/leads/27272727-2222-4000-a000-000000000001',
  'the salesperson''s alert opens the lead');
select ok((select link like '/appointments?auto=1&date=%' from public.notifications
            where recipient_id = '27272727-0000-4000-a000-00000000000a' and dedupe_key like 'appt_cancelled:%'),
  'the admin''s alert opens the auto-cancelled list');
select is((select type || ' / ' || title from public.notifications
            where recipient_id = '27272727-0000-4000-a000-0000000000b1' and dedupe_key like 'appt_cancelled:%'),
  'appointment_auto_cancelled / Booking auto-cancelled: AC Patient 1', 'alert type and title');

------------------------------------------------------------------------------
-- Where staff see it
------------------------------------------------------------------------------
select pg_temp.login('27272727-0000-4000-a000-0000000000b1');
select is((public.appointments_table(jsonb_build_object('from', current_date - 1, 'to', current_date + 2, 'auto_cancelled', true)) ->> 'total')::int,
  1, 'Appointments → filter "Auto-cancelled"');
select is(public.appointments_table(jsonb_build_object('from', current_date - 1, 'to', current_date + 2, 'auto_cancelled', true)) #>> '{rows,0,auto_cancelled}',
  'true', 'the row says auto-cancelled');
select ok(exists (select 1 from jsonb_array_elements(public.today_board() -> 'auto_cancelled') e where e.value ->> 'id' = pg_temp.a('01')::text),
  'reception home lists it under "Auto-cancelled: call back"');
select pg_temp.login('27272727-0000-4000-a000-0000000000c1');
select ok(exists (select 1 from jsonb_array_elements(public.needs_confirmation() -> 'items') e where e.value ->> 'id' = pg_temp.a('01')::text),
  'the salesperson''s "needs confirmation" list shows it');

------------------------------------------------------------------------------
-- Restore & confirm
------------------------------------------------------------------------------
select pg_temp.login('27272727-0000-4000-a000-0000000000c2');
select throws_ok($$ select public.set_appointment_status(pg_temp.a('01'), 'confirmed') $$, 'P0001', 'not_allowed',
  'another salesperson cannot restore it');
select pg_temp.login(null);
select pg_temp.appt('91', 10, 6, 'confirmed');                     -- someone else takes the freed slot
select pg_temp.login('27272727-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.set_appointment_status(pg_temp.a('01'), 'confirmed') $$, 'P0001', 'slot_full',
  'slot taken meanwhile: Restore is refused');
select pg_temp.login(null);
update public.appointments set status = 'cancelled', cancel_reason = 'test' where id = pg_temp.a('91');
select pg_temp.login('27272727-0000-4000-a000-0000000000c1');
select is(public.set_appointment_status(pg_temp.a('01'), 'confirmed') ->> 'status', 'confirmed',
  'slot free again: Confirm restores it');
select pg_temp.login(null);
select is((select confirmed_via::text || ' / ' || coalesce(cancel_reason, '-') || ' / ' || (auto_cancelled_at is null)::text
           from public.appointments where id = pg_temp.a('01')), 'sales_call / - / true', 'confirmed by the sales call, no longer auto-cancelled');
select is((select status::text from public.followups where kind = 'call_to_confirm' and ref_id = pg_temp.a('01')), 'done',
  'its call task is closed');

------------------------------------------------------------------------------
-- Keep cancelled
------------------------------------------------------------------------------
update public.wa_messages set created_at = now() - interval '3 hours', scheduled_for = now() - interval '3 hours' where dedupe_key = 'reminder:' || pg_temp.a('05');
select is(private.appointment_auto_cancel(), 1, 'the reminder is now old enough: auto-cancelled');
select pg_temp.login('27272727-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.set_appointment_status(pg_temp.a('05'), 'cancelled', '') $$, 'P0001', 'invalid_input',
  'keeping it cancelled needs a reason');
select lives_ok($$ select public.set_appointment_status(pg_temp.a('05'), 'cancelled', 'Patient will come next month') $$,
  'keep cancelled with a reason');
select pg_temp.login(null);
select is((select cancel_reason || ' / ' || (auto_cancelled_at is null)::text from public.appointments where id = pg_temp.a('05')),
  'Patient will come next month / true', 'the reason is saved and it leaves the auto-cancelled list');
select is((select status::text from public.followups where kind = 'call_to_confirm' and ref_id = pg_temp.a('05')), 'cancelled',
  'its call task is closed');
select pg_temp.login('27272727-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.set_appointment_status(pg_temp.a('05'), 'confirmed') $$, 'P0001', 'invalid_status_change',
  'a booking a person cancelled cannot be "confirmed" back');
select pg_temp.login(null);

------------------------------------------------------------------------------
-- YES on WhatsApp
------------------------------------------------------------------------------
update public.wa_messages set status = 'read' where dedupe_key = 'reminder:' || pg_temp.a('06');
select is(private.appointment_auto_cancel(), 1, 'auto-cancelled after a read reminder');
select is((public.wa_inbound('{"wa_message_id": "wamid.AC-1", "from": "+919811427006", "kind": "text", "text": "Yes", "action": "confirm"}')) ->> 'action',
  'confirmed', 'YES afterwards, slot still free: confirmed');
select is((select status::text || ' / ' || confirmed_via::text from public.appointments where id = pg_temp.a('06')),
  'confirmed / whatsapp', 'restored as confirmed via WhatsApp');
select is((select count(*)::int from public.notifications where dedupe_key = 'appt_restored:' || pg_temp.a('06') || ':27272727-0000-4000-a000-00000000000a'),
  1, 'staff are told no call is needed');

select pg_temp.reminder('02');
select is(private.appointment_auto_cancel(), 1, 'another one auto-cancelled');
select pg_temp.appt('92', 10, 7, 'confirmed');                     -- its slot is taken
select is((public.wa_inbound('{"wa_message_id": "wamid.AC-2", "from": "+919811427002", "kind": "text", "text": "ok", "action": "confirm"}')) ->> 'action',
  'reschedule', 'YES but the slot is taken: staff must offer another time');
select is((select status::text from public.appointments where id = pg_temp.a('02')), 'cancelled', 'it stays cancelled');
select ok((select reason like 'Said YES on WhatsApp, but the slot is taken%' from public.followups
            where kind = 'call_to_confirm' and ref_id = pg_temp.a('02') and status = 'open'), 'the call task says why');
select is((select count(*)::int from public.notifications where dedupe_key = 'appt_taken:' || pg_temp.a('02') || ':27272727-0000-4000-a000-0000000000b1'),
  1, 'reception is told');

------------------------------------------------------------------------------
-- Switched off; the phone's alerts list
------------------------------------------------------------------------------
select pg_temp.appt('09', 9, 4); select pg_temp.reminder('09');
update public.app_settings set value = value || '{"auto_cancel_hours_before": 0}' where section = 'appointments';
select is(private.appointment_auto_cancel(), 0, 'setting 0 = auto-cancel off');
update public.app_settings set value = value || '{"auto_cancel_hours_before": 12}' where section = 'appointments';
select is(private.appointment_auto_cancel(), 1, 'back on: the waiting booking is cancelled');

select pg_temp.login('27272727-0000-4000-a000-00000000000a');
select ok(jsonb_array_length(public.my_notifications(10)) >= 3, 'the phone''s alerts list has the admin''s alerts');
select is(public.my_notifications(1) #>> '{0,type}', 'appointment_auto_cancelled', 'newest first, with its type');

select * from finish();
rollback;
