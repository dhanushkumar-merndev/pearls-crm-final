-- WhatsApp monthly budget for template messages (Admin → WhatsApp → Template messages).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(19);

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
  ('41414141-0000-4000-a000-00000000000a', 'wb-admin@staff.invalid'),
  ('41414141-0000-4000-a000-0000000000b1', 'wb-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('41414141-0000-4000-a000-00000000000a', 'admin', 'WB Admin', 'wbadmin'),
  ('41414141-0000-4000-a000-0000000000b1', 'receptionist', 'WB Rec', 'wbrec');

-- WhatsApp on, no quiet hours, templates on, utility ₹12, no budget yet.
insert into public.app_settings (section, value) values
  ('whatsapp', '{"enabled": true, "templates_enabled": true, "quiet_start": "00:00", "quiet_end": "00:00", "send_booking_confirmation": true, "send_reminders": false, "cost_utility_paise": 1200, "cost_marketing_paise": 8800}')
on conflict (section) do update set value = excluded.value;
update public.wa_templates set active = false where purpose in ('appointment_booked', 'appointment_reminder');
insert into public.wa_templates (id, name, language, category, status, body_text, param_count, purpose, variable_map) values
  ('41414141-1111-4000-a000-000000000001', 'wb_booked', 'en', 'utility', 'APPROVED', 'Booked {{1}}', 1, 'appointment_booked', '["first_name"]'),
  ('41414141-1111-4000-a000-000000000002', 'wb_reminder', 'en', 'utility', 'APPROVED', 'Reminder {{1}}', 1, 'appointment_reminder', '["first_name"]');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('41414141-2222-4000-a000-000000000001', 'WBTEST-1', 'Asha Budget', '+919811441001');
insert into public.doctors (id, full_name) values ('41414141-3333-4000-a000-000000000001', 'Dr WB Test');

create function pg_temp.book(p_id text)
returns void language sql as $$
  insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, status)
  values (('41414141-4444-4000-a000-0000000000' || p_id)::uuid, '41414141-2222-4000-a000-000000000001',
          '41414141-3333-4000-a000-000000000001', (now() + interval '30 hours')::date,
          now() + interval '30 hours', now() + interval '30 hours 15 minutes', 'pending_confirmation');
$$;
create function pg_temp.queued(p_id text)
returns integer language sql as $$
  select count(*)::int from public.wa_messages where dedupe_key = 'booked:41414141-4444-4000-a000-0000000000' || p_id
$$;
-- Whatever this month already spent on the database (other tests' data) is the starting point.
create temp table base as select private.wa_month_spent() as paise;
grant select on base to authenticated;
create function pg_temp.budget(p_extra integer)
returns bigint language sql as $$ select (select paise from base) + p_extra $$;
grant execute on function pg_temp.budget(integer) to authenticated;
create function pg_temp.alert(p_kind text)
returns integer language sql as $$
  select count(*)::int from public.notifications
  where dedupe_key = 'wa_budget_' || p_kind || ':' || to_char(private.ist(now()), 'YYYY-MM') || ':41414141-0000-4000-a000-00000000000a'
$$;

------------------------------------------------------------------------------
-- Setting the budget
------------------------------------------------------------------------------
select pg_temp.book('01');
select is(pg_temp.queued('01'), 1, 'no budget: a booking queues its confirmation');

select pg_temp.login('41414141-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_set_budget(50000) $$, 'P0001', 'not_allowed', 'reception cannot set the budget');
select pg_temp.login('41414141-0000-4000-a000-00000000000a');
select throws_ok($$ select public.wa_set_budget(50) $$, 'P0001', 'invalid_input', 'less than ₹1 is refused');
select is(public.wa_set_budget(pg_temp.budget(3000)), pg_temp.budget(3000), 'the admin sets a budget');
select pg_temp.login(null);
select is((select (value ->> 'monthly_budget_paise')::bigint from public.app_settings where section = 'whatsapp'), pg_temp.budget(3000),
  'saved in the WhatsApp settings, the other settings kept');
select is((select (value ->> 'send_booking_confirmation')::boolean from public.app_settings where section = 'whatsapp'), true,
  'other WhatsApp settings untouched');

------------------------------------------------------------------------------
-- Spending it
------------------------------------------------------------------------------
-- ₹24 already sent this month (two utility messages): 80 % of ₹30.
insert into public.wa_messages (patient_id, phone_e164, direction, kind, template_id, status, status_rank, category, est_cost_paise)
values ('41414141-2222-4000-a000-000000000001', '+919811441001', 'outbound', 'template', '41414141-1111-4000-a000-000000000001',
        'delivered', 3, 'utility', 2400);
select is(private.wa_month_spent(), pg_temp.budget(2400), 'sent template messages count towards this month');
select ok(not private.wa_over_budget(600), 'one that still fits is allowed');
select ok(private.wa_over_budget(1200), 'one more ₹12 message would go over');

select pg_temp.book('02');
select is(pg_temp.queued('02'), 0, 'over budget: the automatic booking confirmation is skipped');
select is(pg_temp.alert('100'), 1, 'and the admin is told the budget is reached');

select pg_temp.login('41414141-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_send('{"patient_id": "41414141-2222-4000-a000-000000000001", "template_id": "41414141-1111-4000-a000-000000000001"}',
                                           '41414141-5555-4000-a000-000000000001') $$,
  'P0001', 'budget_reached', 'a staff template send is refused with the reason');
select throws_ok($$ select public.wa_number_send('+919811441099', '{"template_id": "41414141-1111-4000-a000-000000000001"}',
                                                  '41414141-5555-4000-a000-000000000002') $$,
  'P0001', 'budget_reached', 'so is a template to a number from the inbox');
select throws_ok($$ select public.wa_send_reminder('41414141-4444-4000-a000-000000000001', 'See you tomorrow', '41414141-5555-4000-a000-000000000003') $$,
  'P0001', 'budget_reached', 'a reminder by hand says the budget is reached (no chat in the last 24 hours)');
select pg_temp.login(null);

-- Queued before the budget ran out (the first booking's confirmation, ₹12): dropped at sending time.
-- A free reply in the 24 hours still goes.
insert into public.wa_messages (id, patient_id, phone_e164, direction, kind, body, status, status_rank)
values ('41414141-5555-4000-a000-000000000004', '41414141-2222-4000-a000-000000000001', '+919811441001', 'outbound', 'text',
        'Thank you', 'queued', 0);
delete from public.notifications where dedupe_key like 'wa_budget_%';
create temp table claimed as select e.value ->> 'id' as id from jsonb_array_elements(public.wa_claim_batch(100)) e;
select is((select error_code from public.wa_messages where dedupe_key = 'booked:41414141-4444-4000-a000-000000000001'), 'budget_reached',
  'a queued template message that would go over is not sent');
select ok(exists (select 1 from claimed where id = '41414141-5555-4000-a000-000000000004'), 'a free text reply is still sent');
select is(pg_temp.alert('100') + pg_temp.alert('80'), 2, 'the sending run tells admins (80 % used, and reached), once each this month');

------------------------------------------------------------------------------
-- No limit again
------------------------------------------------------------------------------
select pg_temp.login('41414141-0000-4000-a000-00000000000a');
select is(public.wa_set_budget(null), null::bigint, 'the admin clears the budget');
select pg_temp.login(null);
select pg_temp.book('03');
select is(pg_temp.queued('03'), 1, 'no limit: booking confirmations go again');

select * from finish();
rollback;
