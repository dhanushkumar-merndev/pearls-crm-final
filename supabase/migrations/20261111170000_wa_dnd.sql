-- Do not disturb, per WhatsApp number (owner: "bot on or off per user; DND so it won't notify:
-- bot or template or both"). dnd_bot: the chat bot never answers this number. dnd_auto: no
-- automatic messages (booking confirmations, reminders, drips, new-lead welcome); queued ones
-- are dropped at sending time. Staff can still write by hand; STOP (opt-out) is separate.

alter table public.wa_contacts
  add column dnd_bot boolean not null default false,
  add column dnd_auto boolean not null default false,
  add column dnd_at timestamptz,
  add column dnd_by uuid references public.staff (id);

-- Which number a chat is with, for someone allowed to see it: a patient or lead (as wa_thread),
-- or a number that is neither yet (reception and admin, as the inbox).
create function private.wa_dnd_phone(p_patient_id uuid, p_lead_id uuid, p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if p_patient_id is not null or p_lead_id is not null then
    perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
    perform private.wa_can_message(p_patient_id, p_lead_id);
    select t.phone_e164 into v_phone from private.wa_target(p_patient_id, p_lead_id) t;
  else
    perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
    v_phone := p_phone;
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.fail('invalid_input');
  end if;
  return v_phone;
end;
$$;

create function public.wa_dnd_get(p_patient_id uuid default null, p_lead_id uuid default null, p_phone text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := private.wa_dnd_phone(p_patient_id, p_lead_id, p_phone);
  v_c public.wa_contacts;
begin
  select * into v_c from public.wa_contacts where phone_e164 = v_phone;
  return jsonb_build_object('phone_e164', v_phone, 'bot', coalesce(v_c.dnd_bot, false), 'auto', coalesce(v_c.dnd_auto, false));
end;
$$;

create function public.wa_dnd_set(p_patient_id uuid, p_lead_id uuid, p_phone text, p_bot boolean, p_auto boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.wa_dnd_phone(p_patient_id, p_lead_id, p_phone);
begin
  if p_bot is null or p_auto is null then
    perform private.fail('invalid_input');
  end if;
  insert into public.wa_contacts as c (phone_e164, dnd_bot, dnd_auto, dnd_at, dnd_by)
  values (v_phone, p_bot, p_auto, now(), private.my_staff_id())
  on conflict (phone_e164) do update set dnd_bot = excluded.dnd_bot, dnd_auto = excluded.dnd_auto,
    dnd_at = now(), dnd_by = excluded.dnd_by, updated_at = now();
  -- A chat the bot is in the middle of goes to staff.
  if p_bot then
    update public.wa_bot_sessions set status = 'handed_over', ended_at = now()
    where phone_e164 = v_phone and status = 'active';
  end if;
  return jsonb_build_object('phone_e164', v_phone, 'bot', p_bot, 'auto', p_auto);
end;
$$;

revoke execute on function public.wa_dnd_get(uuid, uuid, text) from public, anon;
revoke execute on function public.wa_dnd_set(uuid, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.wa_dnd_get(uuid, uuid, text) to authenticated;
grant execute on function public.wa_dnd_set(uuid, uuid, text, boolean, boolean) to authenticated;

create or replace function private.wa_enqueue(p jsonb)
returns public.wa_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
  v_tpl public.wa_templates;
  v_row public.wa_messages;
  v_auto boolean := coalesce((p ->> 'auto')::boolean, false);
  v_patient uuid := (p ->> 'patient_id')::uuid;
  v_lead uuid := (p ->> 'lead_id')::uuid;
  v_text text := nullif(btrim(p ->> 'text'), '');
  v_cost integer := 0;
begin
  select * into v_t from private.wa_target(v_patient, v_lead);
  if v_t.phone_e164 is null then
    return null;
  end if;
  if exists (select 1 from public.wa_contacts c where c.phone_e164 = v_t.phone_e164 and c.opted_out_at is not null) then
    return null;
  end if;
  -- Do not disturb (automatic messages): staff can still write by hand.
  if v_auto and exists (select 1 from public.wa_contacts c where c.phone_e164 = v_t.phone_e164 and c.dnd_auto) then
    return null;
  end if;
  if v_auto and (v_t.wa_mode = 'manual' or not coalesce((private.wa_setting('enabled', 'false'))::boolean, false)) then
    return null;
  end if;
  if v_text is null then
    if nullif(p ->> 'template_id', '') is not null then
      select * into v_tpl from public.wa_templates where id = (p ->> 'template_id')::uuid and active;
    else
      select * into v_tpl from public.wa_templates where purpose = p ->> 'purpose' and active;
    end if;
    if v_tpl.id is null or upper(v_tpl.status) <> 'APPROVED' then
      return null;
    end if;
    v_cost := case v_tpl.category
      when 'marketing' then coalesce((private.wa_setting('cost_marketing_paise', '88'))::int, 88)
      else coalesce((private.wa_setting('cost_utility_paise', '12'))::int, 12) end;
  end if;
  insert into public.wa_messages (id, patient_id, lead_id, phone_e164, direction, kind, template_id, purpose, body, vars,
                                  status, status_rank, category, est_cost_paise, respect_quiet, scheduled_for, sent_by,
                                  appointment_id, drip_send_id, dedupe_key)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), v_patient, case when v_patient is null then v_lead end,
          v_t.phone_e164, 'outbound', case when v_text is null then 'template' else 'text' end, v_tpl.id,
          coalesce(p ->> 'purpose', v_tpl.purpose), coalesce(v_text, v_tpl.body_text),
          case when v_text is null then private.wa_resolve_vars(v_tpl.variable_map, v_patient, v_lead, (p ->> 'appointment_id')::uuid)
               else '[]'::jsonb end,
          'queued', 0, v_tpl.category, v_cost, v_auto, coalesce((p ->> 'scheduled_for')::timestamptz, now()),
          case when v_auto then null else private.my_staff_id() end, (p ->> 'appointment_id')::uuid,
          (p ->> 'drip_send_id')::uuid, nullif(p ->> 'dedupe_key', ''))
  on conflict do nothing
  returning * into v_row;
  return v_row;
end;
$$;

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
  -- Automatic messages queued before Do not disturb was switched on.
  update public.wa_messages m set status = 'failed', status_rank = 2, error_code = 'dnd', error_text = 'do not disturb',
                                  status_at = p_now
  where m.status = 'queued' and m.respect_quiet
    and exists (select 1 from public.wa_contacts c where c.phone_e164 = m.phone_e164 and c.dnd_auto);
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

create or replace function private.wa_bot_on_inbound(p_msg public.wa_messages, p jsonb)
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
  -- A photo, voice note, video, file, sticker, pin…: the bot reads typed messages only.
  v_media boolean := p_msg.kind in ('media', 'other');
  v_reply text := nullif(p ->> 'reply_id', '');
  v_pick text[];
  v_good boolean := false;
  v_lead uuid := p_msg.lead_id;
  v_n integer := 0;  -- replies queued
begin
  -- An emoji reaction to one of our messages is not an answer.
  if p_msg.kind = 'other' and v_text = '[reaction]' then
    return 0;
  end if;
  if not coalesce((private.wa_setting('enabled', 'false'))::boolean, false)
     or not coalesce((private.setting('wa_bot', 'enabled', 'false'))::boolean, false) then
    return 0;
  end if;
  v_products := private.wa_bot_products();
  if cardinality(v_products) = 0
     or exists (select 1 from public.wa_contacts c where c.phone_e164 = v_phone and (c.opted_out_at is not null or c.dnd_bot)) then
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
                then E'\n\nOur brochure: {brochure}' else '' end
        || case when private.wa_bot_text('website_url', null) is not null
                     and position('{website}' in coalesce(private.wa_bot_text('intro_text', ''), '')) = 0
                then case when private.wa_bot_text('brochure_url', null) is not null then E'\n' else E'\n\n' end
                     || 'Our website: {website}' else '' end,
        private.wa_bot_vars(v_s)),
      null, coalesce(private.wa_bot_text('brochure_url', null), private.wa_bot_text('website_url', null)) is not null);
    perform private.wa_bot_ask(v_s, v_lead, case when v_media then private.wa_bot_text('media_text', 'Sorry, I can only read typed messages. I can''t open photos, voice notes, videos or files. Please type your answer.') end);
    v_n := 2;
  else
    if v_s.step = 'name' then
      if v_typed and length(v_text) between 2 and 60 and v_text ~ '[[:alpha:]]' and v_text !~ '[0-9@/:]'
         and array_length(regexp_split_to_array(v_text, '\s+'), 1) <= 6 then
        update public.wa_bot_sessions set name = v_text, step = 'products', bad_tries = 0 where id = v_s.id returning * into v_s;
        v_good := true;
      end if;
    elsif v_s.step = 'products' then
      if v_reply = 'bot_done' and cardinality(v_s.products) > 0 then
        update public.wa_bot_sessions set step = 'location', bad_tries = 0 where id = v_s.id returning * into v_s;
        v_good := true;
      elsif v_reply ~ '^bot_p:[0-9]{1,2}$' and substr(v_reply, 7)::int between 1 and cardinality(v_products) then
        -- One tap = one more treatment (in list order); all of them chosen → next question.
        v_pick := array(select x from unnest(v_products) with ordinality as u (x, n)
                        where x = any (v_s.products) or n = substr(v_reply, 7)::int order by n);
        update public.wa_bot_sessions
        set products = v_pick, bad_tries = 0,
            step = case when cardinality(v_pick) = cardinality(v_products) then 'location' else 'products' end
        where id = v_s.id returning * into v_s;
        v_good := true;
      else
        v_pick := private.wa_bot_pick(v_products, case when v_typed then v_text end, p -> 'form');
        if v_pick is not null then
          update public.wa_bot_sessions set products = v_pick, step = 'location', bad_tries = 0 where id = v_s.id returning * into v_s;
          v_good := true;
        end if;
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
        perform private.wa_bot_ask(v_s, v_lead, case when v_media
          then private.wa_bot_text('media_text', 'Sorry, I can only read typed messages. I can''t open photos, voice notes, videos or files. Please type your answer.')
          else private.wa_bot_text('sorry_text', 'Sorry, I didn''t get that.') end);
        v_n := 1;
      end if;
    end if;
  end if;

  return v_n;
end;
$$;
