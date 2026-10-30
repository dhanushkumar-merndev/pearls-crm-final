-- WhatsApp Do not disturb per number (bot / automatic messages), and the inbox learning who a
-- number is when staff register the patient or add the lead.
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

create function pg_temp.wa_in(p_from text, p_text text)
returns jsonb
language sql
as $$
  select public.wa_inbound(jsonb_build_object('wa_message_id', 'wamid.dnd.' || gen_random_uuid(), 'from', p_from, 'kind', 'text',
                                              'text', p_text));
$$;

insert into auth.users (id, email) values
  ('25252525-0000-4000-a000-0000000000b1', 'dnd-rec@staff.invalid'),
  ('25252525-0000-4000-a000-0000000000c1', 'dnd-sales@staff.invalid'),
  ('25252525-0000-4000-a000-0000000000c2', 'dnd-sales2@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('25252525-0000-4000-a000-0000000000b1', 'receptionist', 'Dnd Rec', 'dndrec'),
  ('25252525-0000-4000-a000-0000000000c1', 'sales_executive', 'Dnd Sales', 'dndsales'),
  ('25252525-0000-4000-a000-0000000000c2', 'sales_executive', 'Dnd Sales Two', 'dndsales2');

insert into public.app_settings (section, value) values ('whatsapp', '{"enabled": true}')
on conflict (section) do update set value = public.app_settings.value || excluded.value;
insert into public.app_settings (section, value) values
  ('wa_bot', '{"enabled": true, "daily_chat_limit": 5, "products": ["Hair transplant", "Acne care"]}')
on conflict (section) do update set value = excluded.value;
update public.wa_templates set active = false where purpose = 'appointment_booked';
insert into public.wa_templates (id, name, language, category, status, body_text, param_count, purpose, variable_map) values
  ('25252525-1111-4000-a000-000000000001', 'dnd_test_booked', 'en', 'utility', 'APPROVED', 'Booked', 0, 'appointment_booked', '[]');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('25252525-2222-4000-a000-000000000001', 'DNDTEST-1', 'Dnd Patient', '+919811025001');
insert into public.leads (id, name, phone_e164, assigned_to) values
  ('25252525-5555-4000-a000-000000000001', 'Dnd Lead', '+919811025002', '25252525-0000-4000-a000-0000000000c1');

------------------------------------------------------------------------------
-- Automatic messages off
------------------------------------------------------------------------------
-- Queued before Do not disturb was switched on.
insert into public.wa_messages (id, patient_id, phone_e164, direction, kind, body, status, respect_quiet)
values ('25252525-3333-4000-a000-000000000001', '25252525-2222-4000-a000-000000000001', '+919811025001', 'outbound', 'template',
        'Reminder', 'queued', true);

select pg_temp.login('25252525-0000-4000-a000-0000000000b1');
select is(public.wa_dnd_get('25252525-2222-4000-a000-000000000001', null, null) - 'phone_e164',
  '{"bot": false, "auto": false}'::jsonb, 'nothing is muted at first');
select is(public.wa_dnd_set('25252525-2222-4000-a000-000000000001', null, null, false, true) ->> 'auto', 'true',
  'reception mutes automatic messages for a patient');
select pg_temp.login(null);

select is((private.wa_enqueue(jsonb_build_object('patient_id', '25252525-2222-4000-a000-000000000001',
                                                 'purpose', 'appointment_booked', 'auto', true))).id, null,
  'a booking confirmation is not queued');
select isnt((private.wa_enqueue(jsonb_build_object('patient_id', '25252525-2222-4000-a000-000000000001',
                                                   'text', 'Hello from the desk'))).id, null,
  'staff can still write by hand');
select public.wa_claim_batch(100);
select is((select error_code from public.wa_messages where id = '25252525-3333-4000-a000-000000000001'), 'dnd',
  'an automatic message queued earlier is dropped when sending');

------------------------------------------------------------------------------
-- Chat bot off
------------------------------------------------------------------------------
select is((pg_temp.wa_in('+919811025003', 'hi') ->> 'bot')::int, 2, 'the bot answers a new number');
select pg_temp.login('25252525-0000-4000-a000-0000000000b1');
select public.wa_dnd_set(null, null, '+919811025003', true, false);
select pg_temp.login(null);
select is((select status from public.wa_bot_sessions where phone_e164 = '+919811025003'), 'handed_over',
  'switching the bot off hands its chat to staff');
select is(coalesce((pg_temp.wa_in('+919811025003', 'Asha') ->> 'bot')::int, 0), 0, 'and it stays quiet');

select pg_temp.login('25252525-0000-4000-a000-0000000000b1');
select public.wa_dnd_set(null, null, '+919811025004', true, false);
select pg_temp.login(null);
select is(coalesce((pg_temp.wa_in('+919811025004', 'hi') ->> 'bot')::int, 0), 0, 'muted before the first message: no bot at all');

------------------------------------------------------------------------------
-- Who may change it
------------------------------------------------------------------------------
select pg_temp.login('25252525-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.wa_dnd_set(null, null, '+919811025003', false, false) $$, 'P0001', 'not_allowed',
  'sales cannot change numbers that are not leads');
select is(public.wa_dnd_set(null, '25252525-5555-4000-a000-000000000001', null, true, true) ->> 'bot', 'true',
  'a sales executive mutes their own lead');
select pg_temp.login('25252525-0000-4000-a000-0000000000c2');
select throws_ok($$ select public.wa_dnd_get(null, '25252525-5555-4000-a000-000000000001', null) $$, 'P0001', 'not_allowed',
  'another executive cannot see it');
select pg_temp.login('25252525-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_dnd_set(null, null, '98110', true, true) $$, 'P0001', 'invalid_input', 'a bad number is refused');
select pg_temp.login(null);

------------------------------------------------------------------------------
-- The inbox learns the name when staff register or add them
------------------------------------------------------------------------------
update public.app_settings set value = value || '{"enabled": false}' where section = 'wa_bot';
select pg_temp.wa_in('+919811025005', 'Hello');
select is((select patient_id from public.wa_threads where phone_e164 = '+919811025005'), null, 'unknown at first');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('25252525-2222-4000-a000-000000000005', 'DNDTEST-5', 'Later Patient', '+919811025005');
select is((select patient_id::text from public.wa_threads where phone_e164 = '+919811025005'), '25252525-2222-4000-a000-000000000005',
  'registering the patient names the conversation');

select pg_temp.wa_in('+919811025006', 'Price?');
insert into public.leads (id, name, phone_e164) values ('25252525-5555-4000-a000-000000000006', 'Later Lead', '+919811025006');
select is((select lead_id::text from public.wa_threads where phone_e164 = '+919811025006'), '25252525-5555-4000-a000-000000000006',
  'adding the lead names the conversation');
update public.leads set phone_e164 = '+919811025099' where id = '25252525-5555-4000-a000-000000000001';
select is((select lead_id from public.wa_threads where phone_e164 = '+919811025002'), null,
  'a lead''s old number keeps whatever it had (nothing is unlinked)');

select * from finish();
