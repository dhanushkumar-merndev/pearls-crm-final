-- WhatsApp chat bot: intro + brochure → name → treatments → area → summary → confirm (lead) / cancel;
-- silent for patients, open leads, staff chats, opted-out numbers and after the daily limit.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(46);

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

-- One incoming message the way wa-webhook hands it over.
create function pg_temp.wa_in(p_from text, p_text text, p_kind text default 'text', p_action text default null,
                              p_reply text default null, p_form jsonb default null)
returns jsonb
language sql
as $$
  select public.wa_inbound(jsonb_build_object('wa_message_id', 'wamid.bot.' || gen_random_uuid(), 'from', p_from, 'kind', p_kind,
                                              'text', p_text, 'action', p_action, 'reply_id', p_reply, 'form', p_form));
$$;
create function pg_temp.session(p_phone text)
returns public.wa_bot_sessions
language sql
as $$
  select * from public.wa_bot_sessions where phone_e164 = p_phone order by started_at desc, id limit 1;
$$;
create function pg_temp.last_bot(p_phone text)
returns public.wa_messages
language sql
as $$
  select * from public.wa_messages where phone_e164 = p_phone and direction = 'outbound' and purpose = 'bot'
  order by created_at desc limit 1;
$$;

insert into auth.users (id, email) values
  ('24242424-0000-4000-a000-00000000000a', 'bot-admin@staff.invalid'),
  ('24242424-0000-4000-a000-0000000000b1', 'bot-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('24242424-0000-4000-a000-00000000000a', 'admin', 'Bot Admin', 'botadmin'),
  ('24242424-0000-4000-a000-0000000000b1', 'receptionist', 'Bot Rec', 'botrec');

insert into public.app_settings (section, value) values ('whatsapp', '{"enabled": true}')
on conflict (section) do update set value = public.app_settings.value || excluded.value;
insert into public.app_settings (section, value) values
  ('wa_bot', '{"enabled": true, "brochure_url": "https://example.com/brochure.pdf", "website_url": "https://example.com", "daily_chat_limit": 2,
               "products": ["Hair transplant", "Laser hair removal", "Acne care"]}')
on conflict (section) do update set value = excluded.value;
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('24242424-2222-4000-a000-000000000001', 'BOTTEST-1', 'Known Patient', '+919811024009');
-- The lead_welcome template exists, so a normal new lead would get it.
insert into public.wa_templates (id, name, language, category, status, body_text, param_count, purpose, variable_map) values
  ('24242424-1111-4000-a000-000000000001', 'bot_test_welcome', 'en', 'marketing', 'APPROVED', 'Welcome', 0, 'lead_welcome', '[]');
update public.wa_templates set active = false where purpose = 'lead_welcome' and id <> '24242424-1111-4000-a000-000000000001';

------------------------------------------------------------------------------
-- The whole chat
------------------------------------------------------------------------------
select is((pg_temp.wa_in('+919811024001', 'Hi') ->> 'bot')::int, 2, 'a new number gets two messages (intro, then the name question)');
select is((pg_temp.session('+919811024001')).step, 'name', 'the chat waits for the name');
select ok((select bool_or(body like E'%Our brochure: https://example.com/brochure.pdf\nOur website: https://example.com' and payload = '{"preview_url": true}')
           from public.wa_messages where phone_e164 = '+919811024001' and purpose = 'bot'),
  'the intro carries the brochure and website links, with a preview');

select pg_temp.wa_in('+919811024001', '12345');
select is(((pg_temp.session('+919811024001')).step, (pg_temp.session('+919811024001')).bad_tries),
          ('name'::text, 1::smallint), 'a number is not a name: asked again');
select ok((pg_temp.last_bot('+919811024001')).body like 'Sorry%', 'the retry says sorry first');

select pg_temp.wa_in('+919811024001', 'Asha Rao');
select is((pg_temp.session('+919811024001')).step, 'products', 'name saved, treatments next');
select is(((pg_temp.last_bot('+919811024001')).payload ->> 'type', jsonb_array_length((pg_temp.last_bot('+919811024001')).payload #> '{action,sections,0,rows}')),
          ('list'::text, 3), 'no tick-box form yet: a tap list with every treatment');

select pg_temp.wa_in('+919811024001', '1 and 3');
select is((pg_temp.session('+919811024001')).products, array['Hair transplant', 'Acne care'], '"1 and 3" picks those two');

select pg_temp.wa_in('+919811024001', 'Jayanagar, Bengaluru');
select is((pg_temp.session('+919811024001')).step, 'confirm', 'area saved, summary next');
select ok((pg_temp.last_bot('+919811024001')).kind = 'interactive'
          and (pg_temp.last_bot('+919811024001')).body like '%Asha Rao%+91 98110 24001%Hair transplant, Acne care%Jayanagar, Bengaluru%',
  'the summary shows name, their WhatsApp number, treatments and area');
select is((pg_temp.last_bot('+919811024001')).payload #>> '{action,buttons,0,reply,id}', 'bot_confirm', 'with Confirm and Cancel buttons');

select pg_temp.wa_in('+919811024001', 'Confirm', 'button_reply', 'confirm', 'bot_confirm');
select is((pg_temp.session('+919811024001')).status, 'confirmed', 'Confirm ends the chat');
select ok(exists (select 1 from public.leads l join public.lookup_values s on s.id = l.source_id
                  where l.id = (pg_temp.session('+919811024001')).lead_id and l.name = 'Asha Rao' and l.created_via = 'whatsapp'
                    and s.code = 'whatsapp' and l.treatment_text = 'Hair transplant, Acne care' and l.comments1 like '%Jayanagar%'),
  'a lead is made: name, source WhatsApp, treatments, area');
select is((select count(*)::int from public.wa_messages where dedupe_key = 'welcome:' || (pg_temp.session('+919811024001')).lead_id), 0,
  'no lead_welcome template on top of the bot''s thank-you');
select ok((pg_temp.last_bot('+919811024001')).body like 'Thank you, Asha Rao%', 'the bot says thank you');
select is((select count(*)::int from public.wa_messages where phone_e164 = '+919811024001' and lead_id is null), 0,
  'the whole chat is linked to the lead');
select is((pg_temp.wa_in('+919811024001', 'Thanks!') ->> 'bot')::int, 0, 'after that the number has an open lead: the bot is quiet');

-- Tapping treatments one by one.
select pg_temp.wa_in('+919811024006', 'hi');
select pg_temp.wa_in('+919811024006', 'Kiran');
select pg_temp.wa_in('+919811024006', 'Laser hair removal', 'button_reply', null, 'bot_p:2');
select is(((pg_temp.session('+919811024006')).step, (pg_temp.session('+919811024006')).products),
          ('products'::text, array['Laser hair removal']), 'a tap adds one treatment and asks for more');
select is((pg_temp.last_bot('+919811024006')).payload #> '{action,sections,0,rows}',
          '[{"id": "bot_done", "title": "✅ Done", "description": "Continue"},
            {"id": "bot_p:1", "title": "Hair transplant"}, {"id": "bot_p:3", "title": "Acne care"}]'::jsonb,
  'the next list has Done first and leaves out what was chosen');
select pg_temp.wa_in('+919811024006', 'Hair transplant', 'button_reply', null, 'bot_p:1');
select pg_temp.wa_in('+919811024006', '✅ Done', 'button_reply', 'confirm', 'bot_done');
select is(((pg_temp.session('+919811024006')).step, (pg_temp.session('+919811024006')).products),
          ('location'::text, array['Hair transplant', 'Laser hair removal']), 'Done moves on, treatments in list order');

------------------------------------------------------------------------------
-- Cancel, the tick-box form, three bad answers, the daily limit
------------------------------------------------------------------------------
update public.app_settings set value = value || '{"flow_id": "123456789"}' where section = 'wa_bot';
select pg_temp.wa_in('+919811024002', 'hello');
select pg_temp.wa_in('+919811024002', 'Ravi');
select is((pg_temp.last_bot('+919811024002')).payload ->> 'type', 'flow', 'with a form set up, the treatments come as a tick-box form');
select is((pg_temp.last_bot('+919811024002')).payload #> '{action,parameters,flow_action_payload,data,options,1}',
          '{"id": "Laser hair removal", "title": "Laser hair removal"}'::jsonb, 'the form gets today''s list from the settings');
select pg_temp.wa_in('+919811024002', '✔ Acne care', 'button_reply', null, null, '{"choices": ["Acne care", "Not on the list"]}');
select is((pg_temp.session('+919811024002')).products, array['Acne care'], 'the ticked treatments are saved (unknown ones dropped)');
select pg_temp.wa_in('+919811024002', 'Mysuru');
select pg_temp.wa_in('+919811024002', 'no', 'text', 'reschedule');
select is((pg_temp.session('+919811024002')).status, 'cancelled', '"no" at the summary cancels');
select is((pg_temp.session('+919811024002')).lead_id, null, 'a cancelled chat makes no lead');

select pg_temp.wa_in('+919811024002', 'hi again');
select is((select count(*)::int from public.wa_bot_sessions where phone_e164 = '+919811024002'), 2, 'after a cancel they can start again');
select pg_temp.wa_in('+919811024002', '???');
select pg_temp.wa_in('+919811024002', '!!!');
select is((pg_temp.wa_in('+919811024002', '...') ->> 'bot')::int, 0, 'the third unusable answer gets no reply');
-- Both chats started inside this one test transaction (same start time): count, don't pick the latest.
select is((select count(*)::int from public.wa_bot_sessions where phone_e164 = '+919811024002' and status = 'stopped'), 1,
  'and ends the chat');
select is((pg_temp.wa_in('+919811024002', 'hi') ->> 'bot')::int, 0, 'daily limit (2 chats) reached: no new chat today');

------------------------------------------------------------------------------
-- Photos, voice notes, files: the bot reads typed messages only
------------------------------------------------------------------------------
select is((pg_temp.wa_in('+919811024050', '[image]', 'media') ->> 'bot')::int, 2, 'a photo first: intro, then the name question');
select ok((pg_temp.last_bot('+919811024050')).body like E'Sorry, I can only read typed messages%\n\nMay I know your name?',
  'it says photos can''t be read, then asks the name');
select pg_temp.wa_in('+919811024050', '[audio]', 'media');
select ok((pg_temp.last_bot('+919811024050')).body like 'Sorry, I can only read typed messages%', 'a voice note gets the same note');
select is(coalesce((pg_temp.wa_in('+919811024050', '[reaction]', 'other') ->> 'bot')::int, 0), 0, 'an emoji reaction gets no reply');
select is((pg_temp.session('+919811024050')).bad_tries, 1::smallint, 'the voice note counted once, the reaction not at all');
select pg_temp.wa_in('+919811024050', 'Meena');
select is((pg_temp.session('+919811024050')).step, 'products', 'typing the name carries on');

------------------------------------------------------------------------------
-- When the bot stays out
------------------------------------------------------------------------------
select is((pg_temp.wa_in('+919811024009', 'hello') ->> 'bot')::int, 0, 'an existing patient is left to reception');

select pg_temp.wa_in('+919811024003', 'hi');
insert into public.wa_messages (phone_e164, direction, kind, body, status, sent_by)
values ('+919811024003', 'outbound', 'text', 'Hello, this is the clinic', 'queued', '24242424-0000-4000-a000-0000000000b1');
select is((pg_temp.session('+919811024003')).status, 'handed_over', 'a staff message hands the chat over');
select is((pg_temp.wa_in('+919811024003', 'Meera') ->> 'bot')::int, 0, 'and the bot stays quiet while staff chat');

select pg_temp.wa_in('+919811024004', 'hi');
select pg_temp.wa_in('+919811024004', 'STOP', 'text', 'stop');
select is((pg_temp.session('+919811024004')).status, 'stopped', 'STOP ends the chat');
select is((pg_temp.wa_in('+919811024004', 'hello') ->> 'bot')::int, 0, 'and an opted-out number gets nothing');

update public.app_settings set value = value || '{"enabled": false}' where section = 'wa_bot';
select is((pg_temp.wa_in('+919811024005', 'hi') ->> 'bot')::int, 0, 'bot switched off: nothing');

------------------------------------------------------------------------------
-- Pieces and access
------------------------------------------------------------------------------
select is(private.wa_bot_pick(array['A x', 'B y', 'C z'], 'a x, C Z', null), array['A x', 'C z'], 'typed names are understood');
select is(private.wa_bot_pick(array['A', 'B'], '3', null), null, 'a number not on the list is not an answer');

select public.wa_bot_flow_saved('987654321', true);
select is((select value ->> 'flow_id' from public.app_settings where section = 'wa_bot'), '987654321', 'a published form is saved for the bot');

select pg_temp.login('24242424-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.wa_bot_overview() $$, 'P0001', 'not_allowed', 'only admins see the bot''s chats');
select pg_temp.login('24242424-0000-4000-a000-00000000000a');
select ok((public.wa_bot_overview() ->> 'today')::int >= 6, 'admin sees today''s chats');
select pg_temp.login(null);

select * from finish();
rollback;
