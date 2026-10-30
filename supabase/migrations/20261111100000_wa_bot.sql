-- Pearl CRM — WhatsApp chat bot (owner 30/10/2026: "on a message it introduces, sends the brochure
-- link, asks name, products (tick boxes), location, then shows everything with their number to
-- confirm or cancel; only 5 per number per day").
-- A new number that writes to the clinic gets a short guided chat:
--   intro (+ brochure link) → name → treatments (WhatsApp tick-box form, or numbers "1, 3")
--   → area / city → summary with their WhatsApp number → Confirm (a lead, round-robin) | Cancel.
-- What it says, the treatment list and the brochure link are settings (Admin → WhatsApp → Chat
-- bot, app_settings section 'wa_bot'); an empty text uses the built-in English one below.
-- It stays silent for existing patients, numbers with an open lead, numbers a staff member is
-- chatting with (a staff message hands the chat over), opted-out numbers, and a number that has
-- already started `daily_chat_limit` chats today (IST). Three answers it can't use end the chat.
-- Replies are queued like every other message; wa-dispatch is woken straight away (pg_net).

alter table public.app_settings drop constraint app_settings_section_check;
alter table public.app_settings add constraint app_settings_section_check check (section in (
  'ui', 'security', 'appointments', 'billing', 'pharmacy', 'sales', 'bdm', 'whatsapp',
  'meta', 'storage', 'notifications', 'registration_form', 'wa_bot'));

-- Interactive messages (buttons, the tick-box form) carry Meta's "interactive" object in payload;
-- a text may carry {"preview_url": true} so a brochure link shows its preview.
alter table public.wa_messages drop constraint wa_messages_kind_check;
alter table public.wa_messages add constraint wa_messages_kind_check check (kind in (
  'template', 'text', 'button_reply', 'media', 'manual', 'other', 'interactive'));
alter table public.wa_messages add column payload jsonb check (payload is null or jsonb_typeof(payload) = 'object');

alter table public.leads drop constraint leads_created_via_check;
alter table public.leads add constraint leads_created_via_check check (created_via in (
  'web', 'android', 'meta', 'import', 'reception', 'bdm', 'whatsapp'));

-- Lead source "WhatsApp" (an admin-made one with that name gets the code instead).
update public.lookup_values set code = 'whatsapp'
where kind = 'lead_source' and lower(label) = 'whatsapp' and code is null and merged_into_id is null
  and not exists (select 1 from public.lookup_values where kind = 'lead_source' and code = 'whatsapp');
insert into public.lookup_values (kind, code, label, sort) values ('lead_source', 'whatsapp', 'WhatsApp', 35)
on conflict do nothing;

------------------------------------------------------------------------------
-- One row per chat
------------------------------------------------------------------------------
create table public.wa_bot_sessions (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'active'
    check (status in ('active', 'confirmed', 'cancelled', 'expired', 'stopped', 'handed_over')),
  step text not null default 'name' check (step in ('name', 'products', 'location', 'confirm')),
  name text check (length(name) <= 60),
  products text[] not null default '{}' check (cardinality(products) <= 20),
  location text check (length(location) <= 100),
  bad_tries smallint not null default 0,
  lead_id uuid references public.leads (id),
  started_on date not null,                    -- IST day, for the daily limit
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  ended_at timestamptz
);
create unique index wa_bot_sessions_one_active on public.wa_bot_sessions (phone_e164) where status = 'active';
create index wa_bot_sessions_day on public.wa_bot_sessions (phone_e164, started_on);
create index wa_bot_sessions_recent on public.wa_bot_sessions (started_at desc);
create index wa_bot_sessions_lead on public.wa_bot_sessions (lead_id) where lead_id is not null;
create trigger wa_bot_sessions_touch before update on public.wa_bot_sessions
  for each row execute function private.touch_updated();

alter table public.wa_bot_sessions enable row level security;
create policy wa_bot_sessions_select on public.wa_bot_sessions for select to authenticated
  using ((select private.my_role()) = 'admin');

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
-- A bot text from the settings, or the built-in one when empty.
create function private.wa_bot_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(private.setting('wa_bot', p_key, 'null') #>> '{}'), ''), p_default);
$$;

-- The treatment list (max 20, each max 30 characters: Meta's tick-box limits), in admin order.
create function private.wa_bot_products()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array(
    select left(btrim(e.x), 30)
    from jsonb_array_elements_text(case when jsonb_typeof(private.setting('wa_bot', 'products', '[]')) = 'array'
                                        then private.setting('wa_bot', 'products', '[]') else '[]'::jsonb end)
         with ordinality as e (x, n)
    where btrim(e.x) <> ''
    order by e.n
    limit 20), '{}');
$$;

-- {clinic}, {name}, … → values.
create function private.wa_bot_fill(p_text text, p_vars jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_val text;
  v_out text := p_text;
begin
  for v_key, v_val in select key, value from jsonb_each_text(p_vars) loop
    v_out := replace(v_out, '{' || v_key || '}', coalesce(v_val, ''));
  end loop;
  return v_out;
end;
$$;

-- +919876543210 → +91 98765 43210 (other countries as they are).
create function private.wa_bot_phone(p_e164 text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_e164 ~ '^\+91[0-9]{10}$' then '+91 ' || substr(p_e164, 4, 5) || ' ' || substr(p_e164, 9) else p_e164 end;
$$;

create function private.wa_bot_vars(p_s public.wa_bot_sessions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'clinic', (select c.name from public.clinic_settings c where c.branch_code = 'main'),
    'brochure', coalesce(private.wa_bot_text('brochure_url', null), ''),
    'name', coalesce(p_s.name, ''),
    'phone', private.wa_bot_phone(p_s.phone_e164),
    'products', array_to_string(p_s.products, ', '),
    'location', coalesce(p_s.location, ''));
$$;

-- Queues one bot message (text, or Meta's interactive object). Bot replies answer the person
-- straight away, so quiet hours don't apply. clock_timestamp(), not now(): two messages queued
-- by one incoming message (welcome, then the first question) keep their order when sent.
create function private.wa_bot_say(p_s public.wa_bot_sessions, p_lead uuid, p_body text, p_interactive jsonb default null,
                                   p_preview boolean default false)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.wa_messages (lead_id, phone_e164, direction, kind, purpose, body, payload, status, status_rank,
                                  scheduled_for, created_at, status_at)
  values (p_lead, p_s.phone_e164, 'outbound', case when p_interactive is null then 'text' else 'interactive' end, 'bot',
          left(p_body, 4096),
          case when p_interactive is not null then p_interactive when p_preview then '{"preview_url": true}'::jsonb end,
          'queued', 0, clock_timestamp(), clock_timestamp(), clock_timestamp());
$$;

-- Asks the question for the chat's current step (p_prefix: "Sorry, I didn't get that." on a retry).
create function private.wa_bot_ask(p_s public.wa_bot_sessions, p_lead uuid, p_prefix text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vars jsonb := private.wa_bot_vars(p_s);
  v_products text[] := private.wa_bot_products();
  v_flow text := nullif(btrim(private.setting('wa_bot', 'flow_id', 'null') #>> '{}'), '');
  v_list text;
  v_body text;
  v_pre text := case when p_prefix is null then '' else p_prefix || E'\n\n' end;
begin
  if p_s.step = 'name' then
    perform private.wa_bot_say(p_s, p_lead, v_pre || private.wa_bot_fill(private.wa_bot_text('name_text', 'May I know your name?'), v_vars));
  elsif p_s.step = 'products' then
    select string_agg(n || '. ' || x, E'\n' order by n) into v_list from unnest(v_products) with ordinality as u (x, n);
    v_body := v_pre || private.wa_bot_fill(private.wa_bot_text('products_text', 'Thanks, {name}! Which treatments are you interested in?'), v_vars);
    if v_flow is not null and v_flow ~ '^[0-9]{5,30}$' then
      v_body := v_body || E'\n\n' || 'Tap the button below and tick all that apply, or reply with the numbers:' || E'\n' || v_list;
      perform private.wa_bot_say(p_s, p_lead, v_body, jsonb_build_object(
        'type', 'flow',
        'body', jsonb_build_object('text', left(v_body, 1024)),
        'action', jsonb_build_object('name', 'flow', 'parameters', jsonb_build_object(
          'flow_message_version', '3',
          'flow_token', p_s.id::text,
          'flow_id', v_flow,
          'flow_cta', left(private.wa_bot_text('form_button', 'Choose treatments'), 30),
          'flow_action', 'navigate',
          'flow_action_payload', jsonb_build_object('screen', 'PICK', 'data', jsonb_build_object(
            'label', left(private.wa_bot_text('form_button', 'Choose treatments'), 30),
            'options', (select jsonb_agg(jsonb_build_object('id', x, 'title', x) order by n)
                        from unnest(v_products) with ordinality as u (x, n))))))));
    else
      v_body := v_body || E'\n\n' || 'Reply with the numbers, for example 1, 3' || E'\n' || v_list;
      perform private.wa_bot_say(p_s, p_lead, v_body);
    end if;
  elsif p_s.step = 'location' then
    perform private.wa_bot_say(p_s, p_lead, v_pre || private.wa_bot_fill(private.wa_bot_text('location_text', 'Which area or city are you in?'), v_vars));
  elsif p_s.step = 'confirm' then
    v_body := v_pre || private.wa_bot_fill(private.wa_bot_text('summary_text',
      E'Please check your details:\n\nName: {name}\nWhatsApp number: {phone}\nTreatments: {products}\nArea / city: {location}\n\nIs this correct?'), v_vars);
    perform private.wa_bot_say(p_s, p_lead, v_body, jsonb_build_object(
      'type', 'button',
      'body', jsonb_build_object('text', left(v_body, 1024)),
      'action', jsonb_build_object('buttons', jsonb_build_array(
        jsonb_build_object('type', 'reply', 'reply', jsonb_build_object('id', 'bot_confirm',
          'title', left(private.wa_bot_text('confirm_button', 'Confirm'), 20))),
        jsonb_build_object('type', 'reply', 'reply', jsonb_build_object('id', 'bot_cancel',
          'title', left(private.wa_bot_text('cancel_button', 'Cancel'), 20)))))));
  end if;
end;
$$;

-- Treatments picked: from the tick-box form ({"choices": [...]}) or typed — numbers ("1, 3",
-- "2 and 4") or the names themselves ("Hair transplant, Acne"). Null when it isn't a clear answer.
create function private.wa_bot_pick(p_products text[], p_text text, p_form jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nums int[];
  v_parts text[];
  v_out text[];
begin
  if p_form is not null and jsonb_typeof(p_form -> 'choices') = 'array' then
    v_out := array(select x from unnest(p_products) with ordinality as u (x, n)
                   where x in (select jsonb_array_elements_text(p_form -> 'choices')) order by n);
    return case when cardinality(v_out) > 0 then v_out end;
  end if;
  if p_text is null or length(p_text) > 500 then
    return null;
  end if;
  -- Numbers: "1, 3", "1 3", "2 and 4".
  if regexp_replace(lower(p_text), '\mand\M', ',', 'g') ~ '^[\s0-9,.;&/+-]+$' and p_text ~ '[0-9]' then
    v_nums := array(select distinct t::int from regexp_split_to_table(p_text, '[^0-9]+') t where t <> '' and length(t) <= 3);
    if cardinality(v_nums) = 0 or exists (select 1 from unnest(v_nums) k where k < 1 or k > cardinality(p_products)) then
      return null;
    end if;
    return array(select p_products[k] from unnest(v_nums) k order by k);
  end if;
  v_parts := array(select lower(btrim(t)) from regexp_split_to_table(p_text, '[,;\n]+') t where btrim(t) <> '');
  if cardinality(v_parts) = 0
     or exists (select 1 from unnest(v_parts) t where t not in (select lower(x) from unnest(p_products) x)) then
    return null;
  end if;
  return array(select x from unnest(p_products) with ordinality as u (x, n) where lower(x) = any (v_parts) order by n);
end;
$$;

-- Confirmed: a lead (round-robin, source WhatsApp), or "enquired again" on an open one with
-- this number. The chat so far is linked to the lead so sales see it.
create function private.wa_bot_make_lead(p_s public.wa_bot_sessions)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.leads;
  v_dup uuid;
  v_row public.leads;
  v_detail jsonb := jsonb_build_object('via', 'whatsapp_bot', 'products', to_jsonb(p_s.products), 'location', p_s.location);
begin
  select l.* into v_open from public.leads l
  where l.deleted_at is null and l.stage not in ('converted', 'lost', 'junk')
    and right(p_s.phone_e164, 10) in (l.phone_last10, l.alt_phone_last10)
  order by l.created_at desc limit 1;
  if v_open.id is not null then
    insert into public.lead_activities (lead_id, kind, data) values (v_open.id, 'enquired_again', v_detail);
    update public.leads set last_activity_at = now() where id = v_open.id;
    perform private.notify_staff(v_open.assigned_to, 'lead_enquired_again', 'Enquired again: ' || v_open.name,
                                 v_open.phone_e164, '/leads/' || v_open.id, 'lead_again:bot:' || p_s.id);
    v_row := v_open;
  else
    select l.id into v_dup from public.leads l
    where l.deleted_at is null and right(p_s.phone_e164, 10) in (l.phone_last10, l.alt_phone_last10)
    order by l.created_at desc limit 1;
    v_row := private.lead_insert(jsonb_strip_nulls(jsonb_build_object(
      'name', p_s.name, 'phone', p_s.phone_e164,
      'treatment_text', left(array_to_string(p_s.products, ', '), 200),
      'comments1', 'WhatsApp chat — area / city: ' || p_s.location,
      'source_code', 'whatsapp', 'source_detail', v_detail, 'duplicate_of_id', v_dup)),
      gen_random_uuid(), 'whatsapp');
  end if;
  update public.wa_messages set lead_id = v_row.id
  where phone_last10 = right(p_s.phone_e164, 10) and phone_e164 = p_s.phone_e164 and patient_id is null
    and lead_id is distinct from v_row.id and created_at >= p_s.started_at;
  update public.wa_threads set lead_id = v_row.id where phone_e164 = p_s.phone_e164 and patient_id is null;
  return v_row.id;
end;
$$;

------------------------------------------------------------------------------
-- The bot: one incoming message → the next step. Returns how many replies it queued.
-- p: what wa_inbound got ({text, kind, action, reply_id, form, …}).
------------------------------------------------------------------------------
create function private.wa_bot_on_inbound(p_msg public.wa_messages, p jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := p_msg.phone_e164;
  v_today date := (private.ist(now()))::date;
  v_products text[];
  v_limit integer;
  v_s public.wa_bot_sessions;
  v_text text := nullif(btrim(coalesce(p ->> 'text', '')), '');
  v_typed boolean := p_msg.kind = 'text';
  v_reply text := nullif(p ->> 'reply_id', '');
  v_pick text[];
  v_good boolean := false;
  v_lead uuid := p_msg.lead_id;
  v_n integer := 0;  -- replies queued
begin
  if not coalesce((private.wa_setting('enabled', 'false'))::boolean, false)
     or not coalesce((private.setting('wa_bot', 'enabled', 'false'))::boolean, false) then
    return 0;
  end if;
  v_products := private.wa_bot_products();
  if cardinality(v_products) = 0
     or exists (select 1 from public.wa_contacts c where c.phone_e164 = v_phone and c.opted_out_at is not null) then
    return 0;
  end if;
  -- One message at a time per number (Meta may deliver two at once).
  perform pg_advisory_xact_lock(hashtextextended('wa_bot:' || v_phone, 0));
  update public.wa_bot_sessions set status = 'expired', ended_at = now()
  where phone_e164 = v_phone and status = 'active' and updated_at < now() - interval '24 hours';
  select * into v_s from public.wa_bot_sessions where phone_e164 = v_phone and status = 'active';

  if v_s.id is null then
    v_limit := least(greatest(coalesce((private.setting('wa_bot', 'daily_chat_limit', '5') #>> '{}')::int, 5), 1), 50);
    if p_msg.patient_id is not null
       or exists (select 1 from public.leads l where l.deleted_at is null and l.stage not in ('converted', 'lost', 'junk')
                    and right(v_phone, 10) in (l.phone_last10, l.alt_phone_last10))
       or exists (select 1 from public.wa_messages m where m.phone_last10 = right(v_phone, 10) and m.phone_e164 = v_phone
                    and m.direction = 'outbound' and m.sent_by is not null and m.created_at > now() - interval '24 hours')
       or (select count(*) from public.wa_bot_sessions s where s.phone_e164 = v_phone and s.started_on = v_today) >= v_limit then
      return 0;
    end if;
    insert into public.wa_bot_sessions (phone_e164, started_on) values (v_phone, v_today) returning * into v_s;
    perform private.wa_bot_say(v_s, v_lead,
      private.wa_bot_fill(
        private.wa_bot_text('intro_text', 'Hi! 👋 Thank you for contacting {clinic}.')
        || case when private.wa_bot_text('brochure_url', null) is not null
                     and position('{brochure}' in coalesce(private.wa_bot_text('intro_text', ''), '')) = 0
                then E'\n\nOur brochure: {brochure}' else '' end,
        private.wa_bot_vars(v_s)),
      null, private.wa_bot_text('brochure_url', null) is not null);
    perform private.wa_bot_ask(v_s, v_lead);
    v_n := 2;
  else
    if v_s.step = 'name' then
      if v_typed and length(v_text) between 2 and 60 and v_text ~ '[[:alpha:]]' and v_text !~ '[0-9@/:]'
         and array_length(regexp_split_to_array(v_text, '\s+'), 1) <= 6 then
        update public.wa_bot_sessions set name = v_text, step = 'products', bad_tries = 0 where id = v_s.id returning * into v_s;
        v_good := true;
      end if;
    elsif v_s.step = 'products' then
      v_pick := private.wa_bot_pick(v_products, case when v_typed then v_text end, p -> 'form');
      if v_pick is not null then
        update public.wa_bot_sessions set products = v_pick, step = 'location', bad_tries = 0 where id = v_s.id returning * into v_s;
        v_good := true;
      end if;
    elsif v_s.step = 'location' then
      if v_typed and length(v_text) between 2 and 100 and v_text ~ '[[:alpha:]]' then
        update public.wa_bot_sessions set location = v_text, step = 'confirm', bad_tries = 0 where id = v_s.id returning * into v_s;
        v_good := true;
      end if;
    elsif v_s.step = 'confirm' then
      if v_reply = 'bot_confirm' or (v_reply is null and p ->> 'action' = 'confirm') then
        v_lead := private.wa_bot_make_lead(v_s);
        update public.wa_bot_sessions set status = 'confirmed', lead_id = v_lead, ended_at = now() where id = v_s.id returning * into v_s;
        perform private.wa_bot_say(v_s, v_lead, private.wa_bot_fill(
          private.wa_bot_text('done_text', 'Thank you, {name}! Our team will call you soon on {phone}.'), private.wa_bot_vars(v_s)));
        v_n := 1;
      elsif v_reply = 'bot_cancel' or (v_reply is null and p ->> 'action' = 'reschedule') then
        update public.wa_bot_sessions set status = 'cancelled', ended_at = now() where id = v_s.id returning * into v_s;
        perform private.wa_bot_say(v_s, v_lead, private.wa_bot_fill(
          private.wa_bot_text('cancelled_text', 'Okay, cancelled. Nothing was saved. Message us any time to start again.'),
          private.wa_bot_vars(v_s)));
        v_n := 1;
      end if;
    end if;

    if v_good then
      perform private.wa_bot_ask(v_s, v_lead);
      v_n := 1;
    elsif v_n = 0 then
      -- Not an answer it can use: ask again, twice at most, then leave it to staff.
      update public.wa_bot_sessions set bad_tries = bad_tries + 1 where id = v_s.id returning * into v_s;
      if v_s.bad_tries >= 3 then
        update public.wa_bot_sessions set status = 'stopped', ended_at = now() where id = v_s.id;
      else
        perform private.wa_bot_ask(v_s, v_lead, private.wa_bot_text('sorry_text', 'Sorry, I didn''t get that.'));
        v_n := 1;
      end if;
    end if;
  end if;

  if v_n > 0 then
    perform private.call_edge('wa-dispatch', '{"source": "bot"}'::jsonb);
  end if;
  return v_n;
end;
$$;

-- A staff member writes to the number: the bot steps aside.
create function private.wa_bot_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.wa_bot_sessions set status = 'handed_over', ended_at = now()
  where phone_e164 = new.phone_e164 and status = 'active';
  return null;
end;
$$;
create trigger wa_messages_bot_handover after insert on public.wa_messages
  for each row when (new.direction = 'outbound' and new.sent_by is not null)
  execute function private.wa_bot_handover();

------------------------------------------------------------------------------
-- Changed from Phase 10
------------------------------------------------------------------------------
-- The bot already thanked a lead it made: no "lead_welcome" template on top.
create or replace function private.wa_on_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_via is distinct from 'whatsapp' then
    perform private.wa_enqueue(jsonb_build_object('lead_id', new.id, 'purpose', 'lead_welcome', 'auto', true,
                                                  'dedupe_key', 'welcome:' || new.id));
  end if;
  perform private.drip_auto_enroll('lead_created', null, new.id, now());
  return null;
end;
$$;

-- Claimed messages carry the interactive payload too.
create or replace function public.wa_claim_batch(p_limit integer default 20, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quiet boolean := private.wa_is_quiet(p_now);
  v_out jsonb := '[]'::jsonb;
  v_m record;
begin
  -- Automatic messages caught by quiet hours move to the end of them.
  if v_quiet then
    update public.wa_messages set scheduled_for = private.wa_after_quiet(p_now)
    where status = 'queued' and respect_quiet and scheduled_for <= p_now;
  end if;
  update public.wa_messages m set status = 'failed', status_rank = 2, error_code = 'opted_out', error_text = 'opted out',
                                  status_at = p_now
  where m.status = 'queued' and exists (select 1 from public.wa_contacts c where c.phone_e164 = m.phone_e164 and c.opted_out_at is not null);
  for v_m in
    select m.* from public.wa_messages m
    where m.status = 'queued' and m.scheduled_for <= p_now and (m.locked_until is null or m.locked_until < p_now)
    order by m.scheduled_for, m.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  loop
    update public.wa_messages set locked_until = p_now + interval '2 minutes', attempts = attempts + 1 where id = v_m.id;
    v_out := v_out || jsonb_build_object(
      'id', v_m.id, 'to', v_m.phone_e164, 'kind', v_m.kind, 'text', v_m.body, 'vars', v_m.vars, 'payload', v_m.payload,
      'template', (select jsonb_build_object('name', t.name, 'language', t.language, 'components', t.components)
                   from public.wa_templates t where t.id = v_m.template_id));
  end loop;
  return v_out;
end;
$$;

-- An incoming message. p: {wa_message_id, from (E.164), kind, text, at, context_wa_id,
-- action: confirm | reschedule | stop | start | null, reply_id?, form?}. Returns what was done.
-- Same as Phase 10, plus: STOP ends a bot chat, and a message nothing else handled goes to the bot.
create or replace function public.wa_inbound(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := p ->> 'from';
  v_at timestamptz := coalesce((p ->> 'at')::timestamptz, now());
  v_action text := nullif(p ->> 'action', '');
  v_patient uuid;
  v_lead uuid;
  v_msg public.wa_messages;
  v_appt public.appointments;
  v_done text;
  v_bot integer := 0;
begin
  if coalesce(v_from, '') !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.fail('invalid_input', 'from');
  end if;
  select id into v_patient from public.patients
   where merged_into_id is null and right(v_from, 10) in (whatsapp_last10, phone_last10)
   order by updated_at desc limit 1;
  if v_patient is null then
    select id into v_lead from public.leads where deleted_at is null and right(v_from, 10) in (phone_last10, alt_phone_last10)
     order by created_at desc limit 1;
  end if;
  insert into public.wa_messages (patient_id, lead_id, phone_e164, direction, kind, body, wa_message_id, status, status_rank,
                                  status_at, context_wa_id, created_at)
  values (v_patient, v_lead, v_from, 'inbound',
          case when p ->> 'kind' in ('text', 'button_reply', 'media') then p ->> 'kind' else 'other' end,
          left(p ->> 'text', 4096), p ->> 'wa_message_id', 'received', 0, v_at, p ->> 'context_wa_id', v_at)
  on conflict (wa_message_id) do nothing
  returning * into v_msg;
  if v_msg.id is null then
    return jsonb_build_object('status', 'repeat');
  end if;
  insert into public.wa_contacts (phone_e164, last_inbound_at) values (v_from, v_at)
  on conflict (phone_e164) do update set last_inbound_at = greatest(public.wa_contacts.last_inbound_at, excluded.last_inbound_at),
                                          updated_at = now();
  -- Any reply stops drips that stop on reply.
  update public.drip_enrollments e set status = 'stopped', stopped_reason = 'replied', next_send_at = null
  from public.drip_campaigns c
  where c.id = e.campaign_id and c.stop_on_reply and e.status in ('active', 'paused')
    and ((v_patient is not null and e.patient_id = v_patient) or (v_lead is not null and e.lead_id = v_lead));
  if v_lead is not null then
    perform private.lead_log(v_lead, 'whatsapp_in', left(p ->> 'text', 2000), jsonb_build_object('message_id', v_msg.id));
    update public.leads set last_activity_at = now() where id = v_lead;
    perform private.notify_staff((select assigned_to from public.leads where id = v_lead), 'whatsapp_reply',
      'WhatsApp reply', left(p ->> 'text', 200), '/leads/' || v_lead, 'wa_in:' || v_msg.id);
  end if;

  if v_action = 'stop' then
    update public.wa_contacts set opted_out_at = v_at, opt_out_source = 'keyword', updated_at = now() where phone_e164 = v_from;
    perform private.drip_stop_for_phone(v_from, 'opted out');
    update public.wa_bot_sessions set status = 'stopped', ended_at = now() where phone_e164 = v_from and status = 'active';
    -- Tell them it worked (free text is allowed: they just wrote).
    insert into public.wa_messages (patient_id, lead_id, phone_e164, direction, kind, body, status, status_rank)
    values (v_patient, v_lead, v_from, 'outbound', 'text',
            coalesce(nullif(btrim(private.wa_setting('stop_reply', 'null') #>> '{}'), ''),
                     'You won''t get WhatsApp messages from us any more. Reply START to get them again.'), 'queued', 0);
    v_done := 'stop';
  elsif v_action = 'start' then
    update public.wa_contacts set opted_out_at = null, opt_out_source = null, updated_at = now() where phone_e164 = v_from;
    v_done := 'start';
  elsif v_action in ('confirm', 'reschedule') then
    -- The nearest upcoming booking of this person; a reply after its time does nothing.
    select a.* into v_appt from public.appointments a
    where ((v_patient is not null and a.patient_id = v_patient) or (v_lead is not null and a.lead_id = v_lead))
      and a.slot_start > v_at and a.status in ('pending_confirmation', 'confirmed')
    order by a.slot_start limit 1
    for update;
    if v_appt.id is not null and v_action = 'confirm' and v_appt.status = 'pending_confirmation' then
      update public.appointments set status = 'confirmed', confirmed_via = 'whatsapp', confirmed_at = now(), version = version + 1
      where id = v_appt.id;
      update public.followups set status = 'done', done_at = now(), outcome = 'confirmed on WhatsApp'
      where kind = 'call_to_confirm' and ref_table = 'appointments' and ref_id = v_appt.id and status = 'open';
      v_done := 'confirmed';
    elsif v_appt.id is not null and v_action = 'reschedule' then
      insert into public.followups (kind, patient_id, lead_id, due_date, reason, source, ref_table, ref_id)
      values ('reschedule_request', v_appt.patient_id, v_appt.lead_id, (private.ist(now()))::date,
              left('Asked on WhatsApp to change the booking: ' || coalesce(p ->> 'text', ''), 500), 'system', 'appointments', v_appt.id)
      on conflict do nothing;
      v_done := 'reschedule';
    end if;
  end if;
  if v_done is not null then
    update public.wa_messages set action = case v_done when 'confirmed' then 'confirmed' else v_done end where id = v_msg.id;
  elsif v_action is distinct from 'start' then
    v_bot := private.wa_bot_on_inbound(v_msg, p);
  end if;
  return jsonb_build_object('status', 'new', 'action', v_done, 'appointment_id', v_appt.id, 'patient_id', v_patient,
                            'lead_id', v_lead, 'bot', v_bot);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

------------------------------------------------------------------------------
-- Admin and the tick-box form
------------------------------------------------------------------------------
-- Admin → WhatsApp → Chat bot: today's and this month's chats, and the latest 20.
create function public.wa_bot_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
  v_month date := date_trunc('month', private.ist(now()))::date;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  return jsonb_build_object(
    'today', (select count(*) from public.wa_bot_sessions where started_on = v_today),
    'active', (select count(*) from public.wa_bot_sessions where status = 'active' and updated_at >= now() - interval '24 hours'),
    'month_confirmed', (select count(*) from public.wa_bot_sessions where started_on >= v_month and status = 'confirmed'),
    'month_cancelled', (select count(*) from public.wa_bot_sessions where started_on >= v_month and status = 'cancelled'),
    'month_total', (select count(*) from public.wa_bot_sessions where started_on >= v_month),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'phone_e164', s.phone_e164, 'name', s.name, 'products', to_jsonb(s.products),
                                          'location', s.location, 'status',
                                          case when s.status = 'active' and s.updated_at < now() - interval '24 hours' then 'expired'
                                               else s.status end,
                                          'step', s.step, 'lead_id', s.lead_id, 'started_at', s.started_at) order by s.started_at desc)
      from (select * from public.wa_bot_sessions order by started_at desc limit 20) s), '[]'::jsonb));
end;
$$;

-- wa-templates-sync: which form exists already.
create function public.wa_bot_flow_get()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('flow_id', private.setting('wa_bot', 'flow_id', 'null'),
                            'flow_draft_id', private.setting('wa_bot', 'flow_draft_id', 'null'));
$$;

-- wa-templates-sync: the form Meta made (draft) or published.
create function public.wa_bot_flow_saved(p_flow_id text, p_published boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patch jsonb;
begin
  if coalesce(p_flow_id, '') !~ '^[0-9]{5,30}$' then
    perform private.fail('invalid_input', 'flow id');
  end if;
  v_patch := case when p_published then jsonb_build_object('flow_id', p_flow_id, 'flow_draft_id', null)
                  else jsonb_build_object('flow_draft_id', p_flow_id) end;
  insert into public.app_settings (section, value) values ('wa_bot', v_patch)
  on conflict (section) do update set value = public.app_settings.value || v_patch,
                                      version = public.app_settings.version + 1, updated_at = now();
end;
$$;

select private.lock_down_public_functions();
revoke execute on function public.wa_bot_flow_get(), public.wa_bot_flow_saved(text, boolean) from public, anon, authenticated;
grant execute on function public.wa_bot_flow_get(), public.wa_bot_flow_saved(text, boolean) to service_role;
