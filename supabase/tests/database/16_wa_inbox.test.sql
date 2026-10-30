-- WhatsApp team inbox: one row per number, unread replies, who sees which conversation.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

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
  ('16161616-0000-4000-a000-00000000000a', 'in-admin@staff.invalid'),
  ('16161616-0000-4000-a000-0000000000b1', 'in-rec@staff.invalid'),
  ('16161616-0000-4000-a000-0000000000c1', 'in-sales@staff.invalid'),
  ('16161616-0000-4000-a000-0000000000c2', 'in-sales2@staff.invalid'),
  ('16161616-0000-4000-a000-0000000000c3', 'in-mgr@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('16161616-0000-4000-a000-00000000000a', 'admin', 'In Admin', 'inadmin'),
  ('16161616-0000-4000-a000-0000000000b1', 'receptionist', 'In Rec', 'inrec'),
  ('16161616-0000-4000-a000-0000000000c1', 'sales_executive', 'In Sales', 'insales'),
  ('16161616-0000-4000-a000-0000000000c2', 'sales_executive', 'In Sales Two', 'insales2'),
  ('16161616-0000-4000-a000-0000000000c3', 'sales_manager', 'In Manager', 'inmgr');

insert into public.patients (id, uhid, full_name, phone_e164) values
  ('16161616-2222-4000-a000-000000000001', 'INTEST-1', 'Inbox Patient', '+919811600001');
insert into public.leads (id, name, phone_e164, assigned_to) values
  ('16161616-5555-4000-a000-000000000001', 'Inbox Lead', '+919811600002', '16161616-0000-4000-a000-0000000000c1');

-- The chat bot stays out of this test (it may be switched on where the tests run).
update public.app_settings set value = value || '{"enabled": false}' where section = 'wa_bot';
insert into public.app_settings (section, value) values ('whatsapp', '{"enabled": true}')
on conflict (section) do update set value = public.app_settings.value || excluded.value;

-- Two replies from the patient, one from the lead, one from an unknown number.
select public.wa_inbound(jsonb_build_object('wa_message_id', 'wamid.IN-T1', 'from', '+919811600001', 'kind', 'text', 'text', 'Hello'));
select public.wa_inbound(jsonb_build_object('wa_message_id', 'wamid.IN-T2', 'from', '+919811600001', 'kind', 'text', 'text', 'Are you open today?'));
select public.wa_inbound(jsonb_build_object('wa_message_id', 'wamid.IN-T3', 'from', '+919811600002', 'kind', 'text', 'text', 'Price please'));
select public.wa_inbound(jsonb_build_object('wa_message_id', 'wamid.IN-T4', 'from', '+919811600009', 'kind', 'text', 'text', 'Who is this'));

select is((select unread_count from public.wa_threads where phone_e164 = '+919811600001'), 2, 'two replies → two unread');
select is((select last_preview from public.wa_threads where phone_e164 = '+919811600001'), 'Are you open today?',
  'the latest message is the preview');
select is((select patient_id::text from public.wa_threads where phone_e164 = '+919811600001'), '16161616-2222-4000-a000-000000000001',
  'the conversation knows its patient');

-- Our message out, then its ticks: unread stays, the status follows the latest message.
insert into public.wa_messages (patient_id, phone_e164, direction, kind, body, status, status_rank, wa_message_id)
values ('16161616-2222-4000-a000-000000000001', '+919811600001', 'outbound', 'text', 'Yes, till 8 pm', 'sent', 1, 'wamid.OUT-T1');
select public.wa_status_update('wamid.OUT-T1', 'read');
select is((select last_status::text || '/' || last_direction::text || '/' || unread_count from public.wa_threads
           where phone_e164 = '+919811600001'), 'read/outbound/2', 'our reply and its read tick show; replies stay unread');

-- Who sees what.
select pg_temp.login('16161616-0000-4000-a000-0000000000b1');
select is((select string_agg(phone_e164, ',' order by phone_e164) from public.wa_threads where phone_e164 like '+9198116000%'),
  '+919811600001,+919811600009', 'reception: patients and unknown numbers, not leads');
select is((public.nav_badges() ->> 'whatsapp')::int >= 2, true, 'reception badge counts unread conversations');
select is((public.wa_inbox() -> 'items' -> 0 ->> 'phone_e164') is not null, true, 'reception inbox lists conversations');
select is((select count(*)::int from jsonb_array_elements(public.wa_inbox() -> 'items') e
           where e.value ->> 'phone_e164' = '+919811600001' and e.value ->> 'name' = 'Inbox Patient' and e.value ->> 'uhid' = 'INTEST-1'), 1,
  'with the patient''s name and UHID');

select pg_temp.login('16161616-0000-4000-a000-0000000000c1');
select is((select string_agg(phone_e164, ',') from public.wa_threads where phone_e164 like '+9198116000%'), '+919811600002',
  'a sales executive sees only their own lead');
select pg_temp.login('16161616-0000-4000-a000-0000000000c2');
select is((select count(*)::int from public.wa_threads where phone_e164 like '+9198116000%'), 0, 'another executive sees none');
select pg_temp.login('16161616-0000-4000-a000-0000000000c3');
select is((select string_agg(phone_e164, ',') from public.wa_threads where phone_e164 like '+9198116000%'), '+919811600002',
  'a sales manager sees leads, not patients');

-- Opening it marks it read for the team.
select pg_temp.login('16161616-0000-4000-a000-0000000000b1');
select is(public.wa_mark_read('16161616-2222-4000-a000-000000000001', null), 1, 'reception opens the conversation');
select is((select unread_count from public.wa_threads where phone_e164 = '+919811600001'), 0, 'nothing unread now');
select throws_ok($$ select public.wa_mark_read(null, '16161616-5555-4000-a000-000000000001') $$, 'P0001', 'not_allowed',
  'reception cannot mark a lead''s conversation');

-- A number that is neither a patient nor a lead: the whole chat, ours on the right.
reset role;
insert into public.wa_messages (phone_e164, direction, kind, body, status, status_rank, wa_message_id, created_at)
values ('+919811600009', 'outbound', 'text', 'Hi! What is your name?', 'sent', 1, 'wamid.OUT-T9', now() + interval '1 second');
select pg_temp.login('16161616-0000-4000-a000-0000000000b1');
select is(jsonb_array_length(public.wa_number_thread('+919811600009') -> 'items'), 2, 'unknown number: every message, not just the last');
select is((select string_agg(e.value ->> 'direction', ',' order by e.ordinality)
           from jsonb_array_elements(public.wa_number_thread('+919811600009') -> 'items') with ordinality e),
  'outbound,inbound', 'newest first, with who sent each');
select is(public.wa_number_thread('+919811600009', null, 1) ->> 'next_cursor' is not null, true, 'pages with a cursor');
select is(public.wa_number_mark_read('+919811600009'), 1, 'opening the unknown number marks it read');
select throws_ok($$ select public.wa_number_thread('98116') $$, 'P0001', 'invalid_input', 'a bad number is refused');
-- Replying from the inbox: free text inside the 24 hours, a template after.
select isnt(public.wa_number_thread('+919811600009') ->> 'window_open_until', null, 'they wrote today: the reply window is open');
select is(public.wa_number_send('+919811600009', '{"text": "Hello, this is the clinic"}', '16161616-7777-4000-a000-000000000001') ->> 'status',
  'queued', 'reception replies to the unknown number');
select is(public.wa_number_send('+919811600009', '{"text": "Hello, this is the clinic"}', '16161616-7777-4000-a000-000000000001') ->> 'repeat',
  'true', 'a retry does not send it twice');
select throws_ok($$ select public.wa_number_send('+919811600009', '{}', '16161616-7777-4000-a000-000000000002') $$, 'P0001', 'invalid_input',
  'no text and no template: nothing is sent');
reset role;
update public.wa_contacts set last_inbound_at = now() - interval '25 hours' where phone_e164 = '+919811600009';
select pg_temp.login('16161616-0000-4000-a000-0000000000b1');
select is(public.wa_number_thread('+919811600009') ->> 'window_open_until', null, 'a day later the window has closed');
select throws_ok($$ select public.wa_number_send('+919811600009', '{"text": "Hi"}', '16161616-7777-4000-a000-000000000003') $$,
  'P0001', 'outside_window', 'then only a template may be sent');
select pg_temp.login('16161616-0000-4000-a000-0000000000c3');
select throws_ok($$ select public.wa_number_thread('+919811600009') $$, 'P0001', 'not_allowed',
  'sales cannot read unknown numbers (reception and admin only)');

select * from finish();
rollback;
