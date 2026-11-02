-- Appointments → "WhatsApp reminder" through the clinic's own WhatsApp (wa_send_reminder).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(29);

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
  ('30303030-0000-4000-a000-0000000000b1', 'rm-rec@staff.invalid'),
  ('30303030-0000-4000-a000-0000000000c1', 'rm-sales@staff.invalid'),
  ('30303030-0000-4000-a000-0000000000c2', 'rm-sales2@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('30303030-0000-4000-a000-0000000000b1', 'receptionist', 'RM Rec', 'rmrec'),
  ('30303030-0000-4000-a000-0000000000c1', 'sales_executive', 'RM Sales', 'rmsales'),
  ('30303030-0000-4000-a000-0000000000c2', 'sales_executive', 'RM Sales Two', 'rmsales2');

-- WhatsApp on, no quiet hours, templates on, reminders 24 h before; one approved reminder template.
insert into public.app_settings (section, value) values
  ('whatsapp', '{"enabled": true, "templates_enabled": true, "quiet_start": "00:00", "quiet_end": "00:00", "send_booking_confirmation": false, "send_reminders": true}')
on conflict (section) do update set value = excluded.value;
insert into public.app_settings (section, value) values ('appointments', '{"reminder_hours_before": 24}')
on conflict (section) do update set value = public.app_settings.value || excluded.value;
update public.wa_templates set active = false where purpose = 'appointment_reminder';
insert into public.wa_templates (id, name, language, category, status, body_text, param_count, purpose, variable_map) values
  ('30303030-1111-4000-a000-000000000001', 'rm_reminder', 'en', 'utility', 'APPROVED', 'Reminder for {{1}}', 1,
   'appointment_reminder', '["first_name"]');

insert into public.patients (id, uhid, full_name, phone_e164) values
  ('30303030-2222-4000-a000-000000000001', 'RMTEST-1', 'Asha Reminder', '+919811430001'),
  ('30303030-2222-4000-a000-000000000002', 'RMTEST-2', 'Ravi Byhand', '+919811430002');
update public.patients set wa_mode = 'manual' where id = '30303030-2222-4000-a000-000000000002';
insert into public.leads (id, name, phone_e164, assigned_to) values
  ('30303030-3333-4000-a000-000000000001', 'RM Lead', '+919811430101', '30303030-0000-4000-a000-0000000000c1');
insert into public.doctors (id, full_name) values ('30303030-5555-4000-a000-000000000001', 'Dr RM Test');

create function pg_temp.book(p_id text, p_patient uuid, p_lead uuid, p_hours integer, p_status text default 'confirmed')
returns void language sql as $$
  insert into public.appointments (id, patient_id, lead_id, doctor_id, appt_date, slot_start, slot_end, status, created_at)
  values (('30303030-4444-4000-a000-0000000000' || p_id)::uuid, p_patient, p_lead, '30303030-5555-4000-a000-000000000001',
          (now() + make_interval(hours => p_hours))::date, now() + make_interval(hours => p_hours),
          now() + make_interval(hours => p_hours) + interval '15 minutes', p_status::public.appt_status,
          now() - interval '3 days');
$$;
select pg_temp.book('01', '30303030-2222-4000-a000-000000000001', null, 30);
select pg_temp.book('02', '30303030-2222-4000-a000-000000000001', null, -2);
select pg_temp.book('03', '30303030-2222-4000-a000-000000000001', null, 50, 'cancelled');
select pg_temp.book('04', '30303030-2222-4000-a000-000000000002', null, 30);
select pg_temp.book('05', null, '30303030-3333-4000-a000-000000000001', 20, 'pending_confirmation');
select pg_temp.book('06', '30303030-2222-4000-a000-000000000001', null, 10);

------------------------------------------------------------------------------
-- Through the clinic's WhatsApp
------------------------------------------------------------------------------
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
create temp table sent as
select public.wa_send_reminder('30303030-4444-4000-a000-000000000001', 'Hello Asha', '30303030-6666-4000-a000-000000000001') r;
select is((select r ->> 'manual' from sent), 'false', 'Cloud API on: the reminder is not a wa.me link');
select is((select r ->> 'kind' from sent), 'template', 'it is the approved reminder template');
select is((select r ->> 'status' from sent), 'queued', 'queued for the sender (shows in their chat)');
select is((select r ->> 'body' from sent), 'Reminder for {{1}}', 'with the template''s text');
select pg_temp.login(null);
select is((select purpose from public.wa_messages where id = '30303030-6666-4000-a000-000000000001'), 'appointment_reminder', 'purpose: reminder');
select is((select appointment_id from public.wa_messages where id = '30303030-6666-4000-a000-000000000001'),
  '30303030-4444-4000-a000-000000000001'::uuid, 'linked to the booking');
select is((select sent_by from public.wa_messages where id = '30303030-6666-4000-a000-000000000001'),
  '30303030-0000-4000-a000-0000000000b1'::uuid, 'sent by the receptionist');
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select is((public.wa_send_reminder('30303030-4444-4000-a000-000000000001', 'Hello Asha', '30303030-6666-4000-a000-000000000001')) ->> 'repeat',
  'true', 'a retry with the same id sends nothing new');
select isnt((public.wa_send_reminder('30303030-4444-4000-a000-000000000001', 'Hello Asha', gen_random_uuid())) ->> 'id', null,
  'a second reminder by hand is allowed');
select pg_temp.login(null);
select is((select count(*)::int from public.wa_messages where appointment_id = '30303030-4444-4000-a000-000000000001'
           and purpose = 'appointment_reminder'), 2, 'two reminders for that booking');
select public.wa_due_reminders();
select is((select count(*)::int from public.wa_messages where appointment_id = '30303030-4444-4000-a000-000000000001'
           and purpose = 'appointment_reminder'), 2, 'sent by hand → the automatic reminder is not sent again');
select is((select count(*)::int from public.wa_messages where dedupe_key = 'reminder:30303030-4444-4000-a000-000000000006'), 1,
  'another booking still gets its automatic one');

------------------------------------------------------------------------------
-- Only before the visit; who may send
------------------------------------------------------------------------------
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000002', 'x', gen_random_uuid()) $$,
  'P0001', 'reminder_not_upcoming', 'not for a visit whose time has passed');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000003', 'x', gen_random_uuid()) $$,
  'P0001', 'reminder_not_upcoming', 'not for a cancelled booking');
select throws_ok($$ select public.wa_send_reminder(gen_random_uuid(), 'x', gen_random_uuid()) $$,
  'P0001', 'not_found', 'unknown booking');
select pg_temp.login('30303030-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000001', 'x', gen_random_uuid()) $$,
  'P0001', 'not_allowed', 'sales may not message a patient''s booking');
select is((public.wa_send_reminder('30303030-4444-4000-a000-000000000005', 'Hi', gen_random_uuid())) ->> 'kind', 'template',
  'the lead''s own sales executive may remind a lead booking');
select pg_temp.login(null);
select ok(exists (select 1 from public.lead_activities where lead_id = '30303030-3333-4000-a000-000000000001' and kind = 'whatsapp'),
  'and it is on the lead''s history');
select pg_temp.login('30303030-0000-4000-a000-0000000000c2');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000005', 'x', gen_random_uuid()) $$,
  'P0001', 'not_allowed', 'another sales executive may not');

------------------------------------------------------------------------------
-- By hand when the Cloud API is off for this person; no template; opted out
------------------------------------------------------------------------------
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select is((public.wa_send_reminder('30303030-4444-4000-a000-000000000004', 'Hello Ravi', gen_random_uuid())) ->> 'manual', 'true',
  'messaged by hand: the app opens WhatsApp with the text');
select pg_temp.login(null);
select is((select body from public.wa_messages where appointment_id = '30303030-4444-4000-a000-000000000004' and kind = 'manual'),
  'Hello Ravi', 'and it is logged in their chat');
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000004', '  ', gen_random_uuid()) $$,
  'P0001', 'invalid_input', 'by hand needs the text');

reset role;
update public.wa_templates set active = false where id = '30303030-1111-4000-a000-000000000001';
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000006', 'x', gen_random_uuid()) $$,
  'P0001', 'no_reminder_template', 'no approved reminder template: a clear reason');

reset role;
insert into public.wa_contacts (phone_e164, opted_out_at) values ('+919811430001', now())
on conflict (phone_e164) do update set opted_out_at = excluded.opted_out_at;
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000006', 'x', gen_random_uuid()) $$,
  'P0001', 'opted_out', 'opted out: refused');

------------------------------------------------------------------------------
-- No template to use, but they wrote to us in the last 24 hours: a normal chat message
------------------------------------------------------------------------------
reset role;
update public.wa_contacts set opted_out_at = null where phone_e164 = '+919811430001';
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000006', 'Hello Asha', gen_random_uuid()) $$,
  'P0001', 'no_reminder_template', 'no template and they have not written lately: still refused');
select pg_temp.login(null);
select public.wa_inbound('{"wa_message_id": "wamid.RM-1", "from": "+919811430001", "kind": "text", "text": "hi"}');
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select is((public.wa_send_reminder('30303030-4444-4000-a000-000000000006', 'Hello Asha, see you at 10', gen_random_uuid())) ->> 'kind',
  'text', 'they wrote within 24 hours: the reminder goes as a chat message');
select pg_temp.login(null);
select is((select body from public.wa_messages where appointment_id = '30303030-4444-4000-a000-000000000006' and kind = 'text'),
  'Hello Asha, see you at 10', 'with the reminder text, in their chat');

reset role;
update public.wa_templates set active = true where id = '30303030-1111-4000-a000-000000000001';
update public.app_settings set value = value || '{"templates_enabled": false}' where section = 'whatsapp';
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select is((public.wa_send_reminder('30303030-4444-4000-a000-000000000006', 'Hello again', gen_random_uuid())) ->> 'kind',
  'text', 'template messages switched off: a chat message inside 24 hours');
reset role;
update public.wa_contacts set last_inbound_at = now() - interval '2 days' where phone_e164 = '+919811430001';
select pg_temp.login('30303030-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send_reminder('30303030-4444-4000-a000-000000000006', 'Hello', gen_random_uuid()) $$,
  'P0001', 'templates_off', 'switched off and outside 24 hours: says template messages are off');

select * from finish();
rollback;
