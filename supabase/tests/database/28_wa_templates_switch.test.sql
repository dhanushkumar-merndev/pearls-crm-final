-- WhatsApp template messages on/off (Admin → WhatsApp button) and the test-record guard.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

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
  ('28282828-0000-4000-a000-00000000000a', 'ts-admin@staff.invalid'),
  ('28282828-0000-4000-a000-0000000000b1', 'ts-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('28282828-0000-4000-a000-00000000000a', 'admin', 'TS Admin', 'tsadmin'),
  ('28282828-0000-4000-a000-0000000000b1', 'receptionist', 'TS Rec', 'tsrec');

-- WhatsApp on, no quiet hours, templates on (the default), reminders 24 h before.
insert into public.app_settings (section, value) values
  ('whatsapp', '{"enabled": true, "quiet_start": "00:00", "quiet_end": "00:00", "send_booking_confirmation": true, "send_reminders": true}')
on conflict (section) do update set value = excluded.value;
insert into public.app_settings (section, value) values ('appointments', '{"reminder_hours_before": 24}')
on conflict (section) do update set value = public.app_settings.value || excluded.value;
insert into public.wa_templates (id, name, language, category, status, body_text, param_count, purpose, variable_map) values
  ('28282828-1111-4000-a000-000000000001', 'ts_booked', 'en', 'utility', 'APPROVED', 'Booked {{1}}', 1, 'appointment_booked', '["first_name"]'),
  ('28282828-1111-4000-a000-000000000002', 'ts_reminder', 'en', 'utility', 'APPROVED', 'Reminder {{1}}', 1, 'appointment_reminder', '["first_name"]');
update public.wa_templates set active = false
where purpose in ('appointment_booked', 'appointment_reminder', 'lead_welcome') and id::text not like '28282828-1111%';

insert into public.patients (id, uhid, full_name, phone_e164) values
  ('28282828-2222-4000-a000-000000000001', 'TSTEST-1', 'Asha Switch', '+919811428001'),
  ('28282828-2222-4000-a000-000000000002', 'TSTEST-2', 'E2E Switch 1', '+919811428002'),
  ('28282828-2222-4000-a000-000000000003', 'TSTEST-3', 'Demo Patient Switch', '+919811428003');
insert into public.doctors (id, full_name) values ('28282828-3333-4000-a000-000000000001', 'Dr TS Test');

create function pg_temp.book(p_id text, p_patient text, p_hours integer)
returns void language sql as $$
  insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, status)
  values (('28282828-4444-4000-a000-0000000000' || p_id)::uuid, ('28282828-2222-4000-a000-0000000000' || p_patient)::uuid,
          '28282828-3333-4000-a000-000000000001', (now() + make_interval(hours => p_hours))::date,
          now() + make_interval(hours => p_hours), now() + make_interval(hours => p_hours) + interval '15 minutes', 'pending_confirmation');
$$;
create function pg_temp.queued(p_key text)
returns integer language sql as $$ select count(*)::int from public.wa_messages where dedupe_key = p_key $$;

------------------------------------------------------------------------------
-- Test records
------------------------------------------------------------------------------
select pg_temp.book('01', '01', 30);
select pg_temp.book('02', '02', 30);
select pg_temp.book('03', '03', 30);
select is(pg_temp.queued('booked:28282828-4444-4000-a000-000000000001'), 1, 'a real patient''s booking queues its confirmation');
select is(pg_temp.queued('booked:28282828-4444-4000-a000-000000000002') + pg_temp.queued('booked:28282828-4444-4000-a000-000000000003'), 0,
  '"E2E …" and "Demo Patient …" records get no automatic message');

select pg_temp.login('28282828-0000-4000-a000-0000000000b1');
select lives_ok($$ select public.wa_send('{"patient_id": "28282828-2222-4000-a000-000000000002", "template_id": "28282828-1111-4000-a000-000000000001"}',
                                          '28282828-5555-4000-a000-000000000001') $$, 'staff can still queue one by hand (the screens work in tests)');
select pg_temp.login(null);
select ok(not exists (select 1 from jsonb_array_elements(public.wa_claim_batch(100)) e where e.value ->> 'id' = '28282828-5555-4000-a000-000000000001'),
  'but it is never handed to Meta');
select is((select error_code from public.wa_messages where id = '28282828-5555-4000-a000-000000000001'), 'test_record', 'it is dropped as a test record');
select is((select status::text from public.wa_messages where dedupe_key = 'booked:28282828-4444-4000-a000-000000000001'), 'queued',
  'the real patient''s message is untouched (sent next run)');

------------------------------------------------------------------------------
-- The switch
------------------------------------------------------------------------------
select pg_temp.login('28282828-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_templates_switch(false) $$, 'P0001', 'not_allowed', 'only an admin may switch templates');
select pg_temp.login('28282828-0000-4000-a000-00000000000a');
select is(public.wa_templates_switch(false), false, 'admin switches template messages off');
select pg_temp.login(null);
select is((select value ->> 'templates_enabled' from public.app_settings where section = 'whatsapp'), 'false', 'saved in WhatsApp settings');

select pg_temp.book('04', '01', 50);
select is(pg_temp.queued('booked:28282828-4444-4000-a000-000000000004'), 0, 'off: a new booking queues no confirmation');
select is((select count(*)::int from public.wa_messages where dedupe_key like 'reminder:28282828-4444-%'
           and public.wa_due_reminders() >= 0), 0, 'off: no reminders are queued');
select pg_temp.login('28282828-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send('{"patient_id": "28282828-2222-4000-a000-000000000001", "template_id": "28282828-1111-4000-a000-000000000001"}',
                                          gen_random_uuid()) $$, 'P0001', 'templates_off', 'off: a staff template send is refused with a clear reason');
select pg_temp.login(null);
select public.wa_inbound('{"wa_message_id": "wamid.TS-1", "from": "+919811428001", "kind": "text", "text": "hello"}');
select pg_temp.login('28282828-0000-4000-a000-0000000000b1');
select is((public.wa_send('{"patient_id": "28282828-2222-4000-a000-000000000001", "text": "Hi Asha"}', '28282828-5555-4000-a000-000000000002')) ->> 'status',
  'queued', 'off: a free reply inside 24 hours still works');
select pg_temp.login(null);
create temp table claimed as select e.value ->> 'id' as id from jsonb_array_elements(public.wa_claim_batch(100)) e;
select ok(exists (select 1 from claimed where id = '28282828-5555-4000-a000-000000000002'), 'and is handed to Meta');
select is((select error_code from public.wa_messages where dedupe_key = 'booked:28282828-4444-4000-a000-000000000001'), 'templates_off',
  'a template message queued before switching off is not sent');

select pg_temp.login('28282828-0000-4000-a000-00000000000a');
select is(public.wa_templates_switch(true), true, 'admin switches them back on');
select pg_temp.login(null);
select pg_temp.book('05', '01', 10);
select ok(public.wa_due_reminders() >= 1 and pg_temp.queued('reminder:28282828-4444-4000-a000-000000000005') = 1,
  'on again: reminders are queued');

select * from finish();
rollback;
