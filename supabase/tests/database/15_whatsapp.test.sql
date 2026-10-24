-- Phase 10: WhatsApp messages, statuses, replies, opt-out, the 24-hour window, quiet hours, drips.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

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
  ('15151515-0000-4000-a000-00000000000a', 'wa-admin@staff.invalid'),
  ('15151515-0000-4000-a000-0000000000b1', 'wa-rec@staff.invalid'),
  ('15151515-0000-4000-a000-0000000000c1', 'wa-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('15151515-0000-4000-a000-00000000000a', 'admin', 'WA Admin', 'waadmin'),
  ('15151515-0000-4000-a000-0000000000b1', 'receptionist', 'WA Rec', 'warec'),
  ('15151515-0000-4000-a000-0000000000c1', 'sales_executive', 'WA Sales', 'wasales');

-- WhatsApp switched on, quiet 21:00–09:00, reminders 24 h before.
insert into public.app_settings (section, value) values
  ('whatsapp', '{"enabled": true, "quiet_start": "21:00", "quiet_end": "09:00", "send_booking_confirmation": true, "send_reminders": true}')
on conflict (section) do update set value = excluded.value;
insert into public.app_settings (section, value) values ('appointments', '{"reminder_hours_before": 24}')
on conflict (section) do update set value = public.app_settings.value || excluded.value;

insert into public.wa_templates (id, name, language, category, status, body_text, param_count, purpose, variable_map) values
  ('15151515-1111-4000-a000-000000000001', 'wa_test_booked', 'en', 'utility', 'APPROVED', 'Hi {{1}}, booked {{2}}', 2, 'appointment_booked', '["first_name", "appt_date"]'),
  ('15151515-1111-4000-a000-000000000002', 'wa_test_reminder', 'en', 'utility', 'APPROVED', 'Reminder {{1}}', 1, 'appointment_reminder', '["appt_time"]'),
  ('15151515-1111-4000-a000-000000000003', 'wa_test_drip', 'en', 'marketing', 'APPROVED', 'Offer', 0, 'other', '[]');
-- Other templates on the project may hold these purposes: switch them off for the test.
update public.wa_templates set active = false
where purpose in ('appointment_booked', 'appointment_reminder', 'lead_welcome') and id::text not like '15151515-1111%';

insert into public.patients (id, uhid, full_name, phone_e164) values
  ('15151515-2222-4000-a000-000000000001', 'WATEST-1', 'Asha Wa Test', '+919811500001'),
  ('15151515-2222-4000-a000-000000000002', 'WATEST-2', 'Ravi Wa Test', '+919811500002'),
  ('15151515-2222-4000-a000-000000000003', 'WATEST-3', 'Meera Wa Test', '+919811500003');
insert into public.doctors (id, full_name) values ('15151515-3333-4000-a000-000000000001', 'Dr Wa Test');

------------------------------------------------------------------------------
-- Booking confirmation (once) and reminders (once)
------------------------------------------------------------------------------
insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, status) values
  ('15151515-4444-4000-a000-000000000001', '15151515-2222-4000-a000-000000000001', '15151515-3333-4000-a000-000000000001',
   (now() + interval '20 hours')::date, now() + interval '20 hours', now() + interval '20 hours 15 minutes', 'pending_confirmation');
select is((select count(*)::int from public.wa_messages where dedupe_key = 'booked:15151515-4444-4000-a000-000000000001'), 1,
  'a new booking queues one confirmation message');
select is((select vars ->> 0 from public.wa_messages where dedupe_key = 'booked:15151515-4444-4000-a000-000000000001'), 'Asha',
  'its variables are filled from the variable map');
select is(public.wa_due_reminders() >= 1, true, 'a booking within 24 hours gets its reminder queued');
select is((select count(*)::int from public.wa_messages where dedupe_key = 'reminder:15151515-4444-4000-a000-000000000001'), 1,
  'once');
select is((select public.wa_due_reminders()) - (select public.wa_due_reminders()), 0, 'running again queues nothing new');

------------------------------------------------------------------------------
-- Statuses only move up; webhook events are processed once
------------------------------------------------------------------------------
select public.wa_mark_result(id, 'wamid.TEST-1') from public.wa_messages where dedupe_key = 'booked:15151515-4444-4000-a000-000000000001';
select is((select status::text from public.wa_messages where wa_message_id = 'wamid.TEST-1'), 'sent', 'Meta accepted it: sent');
select is(public.wa_status_update('wamid.TEST-1', 'read'), true, 'read arrives');
select is(public.wa_status_update('wamid.TEST-1', 'delivered'), false, 'a late "delivered" is ignored');
select is((select status::text from public.wa_messages where wa_message_id = 'wamid.TEST-1'), 'read', 'it stays read');
select is(public.wa_webhook_seen('test-event-1', 'status'), true, 'a webhook event is new the first time');
select is(public.wa_webhook_seen('test-event-1', 'status'), false, 'and ignored when Meta sends it again');

------------------------------------------------------------------------------
-- Replies: YES confirms the next booking; a reply after its time does nothing
------------------------------------------------------------------------------
insert into public.followups (kind, patient_id, due_date, reason, source, ref_table, ref_id) values
  ('call_to_confirm', '15151515-2222-4000-a000-000000000001', current_date, 'Call to confirm', 'system', 'appointments',
   '15151515-4444-4000-a000-000000000001');
select is((public.wa_inbound('{"wa_message_id": "wamid.IN-1", "from": "+919811500001", "kind": "text", "text": "Yes", "action": "confirm"}')) ->> 'action',
  'confirmed', 'YES confirms the nearest upcoming booking');
select is((select status::text || '/' || confirmed_via::text from public.appointments where id = '15151515-4444-4000-a000-000000000001'),
  'confirmed/whatsapp', 'confirmed via WhatsApp');
select is((select status::text from public.followups where ref_id = '15151515-4444-4000-a000-000000000001' and kind = 'call_to_confirm'),
  'done', 'its "call to confirm" task is closed');
select is((public.wa_inbound('{"wa_message_id": "wamid.IN-1", "from": "+919811500001", "kind": "text", "text": "Yes", "action": "confirm"}')) ->> 'status',
  'repeat', 'the same incoming message twice is handled once');

insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, status) values
  ('15151515-4444-4000-a000-000000000002', '15151515-2222-4000-a000-000000000002', '15151515-3333-4000-a000-000000000001',
   (now() - interval '3 hours')::date, now() - interval '3 hours', now() - interval '2 hours 45 minutes', 'pending_confirmation');
select is((public.wa_inbound('{"wa_message_id": "wamid.IN-2", "from": "+919811500002", "kind": "text", "text": "ok", "action": "confirm"}')) ->> 'action',
  null, 'a YES after the booking''s time confirms nothing');

------------------------------------------------------------------------------
-- STOP / START and the 24-hour window
------------------------------------------------------------------------------
select pg_temp.login('15151515-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send('{"patient_id": "15151515-2222-4000-a000-000000000003", "text": "Hello"}', gen_random_uuid()) $$,
  'P0001', 'outside_window', 'free text before the patient has written is refused');
select pg_temp.login(null);
select public.wa_inbound('{"wa_message_id": "wamid.IN-3", "from": "+919811500003", "kind": "text", "text": "hi"}');
select pg_temp.login('15151515-0000-4000-a000-0000000000b1');
select is((public.wa_send('{"patient_id": "15151515-2222-4000-a000-000000000003", "text": "Hello"}', gen_random_uuid())) ->> 'status',
  'queued', 'within 24 hours of their message, free text is fine');
select pg_temp.login(null);
select is((public.wa_inbound('{"wa_message_id": "wamid.IN-4", "from": "+919811500003", "kind": "text", "text": "STOP", "action": "stop"}')) ->> 'action',
  'stop', 'STOP opts the number out');
select is((select count(*)::int from public.wa_messages where phone_e164 = '+919811500003' and direction = 'outbound' and kind = 'text'
           and status = 'queued' and body like '%START%'), 1, 'and queues the "you won''t get messages" reply');
select pg_temp.login('15151515-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send('{"patient_id": "15151515-2222-4000-a000-000000000003", "template_id": "15151515-1111-4000-a000-000000000002"}', gen_random_uuid()) $$,
  'P0001', 'opted_out', 'nothing can be sent to an opted-out number');
select pg_temp.login(null);
select public.wa_inbound('{"wa_message_id": "wamid.IN-5", "from": "+919811500003", "kind": "text", "text": "START", "action": "start"}');
select is((select opted_out_at from public.wa_contacts where phone_e164 = '+919811500003'), null, 'START opts back in');

------------------------------------------------------------------------------
-- Quiet hours and claiming
------------------------------------------------------------------------------
insert into public.wa_messages (id, patient_id, phone_e164, direction, kind, body, status, respect_quiet) values
  ('15151515-5555-4000-a000-000000000001', '15151515-2222-4000-a000-000000000002', '+919811500002', 'outbound', 'text', 'auto', 'queued', true),
  ('15151515-5555-4000-a000-000000000002', '15151515-2222-4000-a000-000000000002', '+919811500002', 'outbound', 'text', 'staff', 'queued', false);
-- 23:00 IST on a test night.
create temp table claimed on commit drop as
  select public.wa_claim_batch(100, '2030-01-10 17:30:00+00') as batch;
select is((select count(*)::int from claimed, jsonb_array_elements(batch) b where b ->> 'id' = '15151515-5555-4000-a000-000000000001'), 0,
  'an automatic message waits during quiet hours');
select is((select private.ist(scheduled_for)::time from public.wa_messages where id = '15151515-5555-4000-a000-000000000001'), '09:00'::time,
  '… until 09:00 IST');
select is((select count(*)::int from claimed, jsonb_array_elements(batch) b where b ->> 'id' = '15151515-5555-4000-a000-000000000002'), 1,
  'a message staff sent goes at once');
select is((select count(*)::int from jsonb_array_elements(public.wa_claim_batch(100, '2030-01-10 17:30:30+00')) b
           where b ->> 'id' = '15151515-5555-4000-a000-000000000002'), 0, 'a claimed message is not handed out twice');

------------------------------------------------------------------------------
-- Drips: each step once, in order; two runs never double-send
------------------------------------------------------------------------------
insert into public.drip_campaigns (id, name, trigger, audience) values
  ('15151515-6666-4000-a000-000000000001', 'WA test drip', 'manual', 'patient');
insert into public.drip_steps (campaign_id, seq, template_id, offset_minutes) values
  ('15151515-6666-4000-a000-000000000001', 1, '15151515-1111-4000-a000-000000000003', 0),
  ('15151515-6666-4000-a000-000000000001', 2, '15151515-1111-4000-a000-000000000003', 60);
select pg_temp.login('15151515-0000-4000-a000-0000000000b1');
select lives_ok($$ select public.drip_enroll('15151515-6666-4000-a000-000000000001', '15151515-2222-4000-a000-000000000002') $$,
  'reception enrols a patient');
select pg_temp.login(null);
select is((select public.wa_drip_due()) + (select public.wa_drip_due()), 1, 'two runs: the first step is sent once');
update public.drip_enrollments set next_send_at = now() - interval '1 minute' where campaign_id = '15151515-6666-4000-a000-000000000001';
select public.wa_drip_due();
select is((select status::text || '/' || (select count(*) from public.drip_sends d where d.enrollment_id = e.id)
           from public.drip_enrollments e where campaign_id = '15151515-6666-4000-a000-000000000001'),
  'completed/2', 'the second step follows and the enrolment completes');

------------------------------------------------------------------------------
-- Who may do what
------------------------------------------------------------------------------
select pg_temp.login('15151515-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.wa_thread('15151515-2222-4000-a000-000000000001') $$, 'P0001', 'not_allowed',
  'sales can''t read a patient''s WhatsApp');
select pg_temp.login('15151515-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_claim_batch(1) $$, '42501', null, 'staff can''t call the dispatcher''s functions');

select * from finish();
rollback;
