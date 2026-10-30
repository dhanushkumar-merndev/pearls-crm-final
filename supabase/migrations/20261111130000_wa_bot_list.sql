-- WhatsApp chat bot: treatments by tapping (owner 30/10/2026: "I said a WhatsApp check list, you
-- gave 1 2 3"). Real tick boxes need a WhatsApp Flow, which Meta publishes only for a verified
-- business (and this account's WABA calls are refused for now). Until a form is set up, the bot
-- sends WhatsApp's tap list: one treatment per tap, the chosen ones left out, "✅ Done" once one
-- is chosen. Typed numbers / names still work; more than 10 rows (Meta's limit) → numbers.
-- Also a website link beside the brochure (setting website_url, {website} in texts).
-- private.wa_bot_vars, private.wa_bot_ask and private.wa_bot_on_inbound as before, with these added.

create or replace function private.wa_bot_vars(p_s public.wa_bot_sessions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'clinic', (select c.name from public.clinic_settings c where c.branch_code = 'main'),
    'brochure', coalesce(private.wa_bot_text('brochure_url', null), ''),
    'website', coalesce(private.wa_bot_text('website_url', null), ''),
    'name', coalesce(p_s.name, ''),
    'phone', private.wa_bot_phone(p_s.phone_e164),
    'products', array_to_string(p_s.products, ', '),
    'location', coalesce(p_s.location, ''));
$$;

create or replace function private.wa_bot_ask(p_s public.wa_bot_sessions, p_lead uuid, p_prefix text default null)
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
  v_rows jsonb;
  v_left integer;
  v_label text := private.wa_bot_text('form_button', 'Choose treatments');
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
      -- WhatsApp's tap list (no approval needed): one treatment per tap, the ones already chosen
      -- left out, "Done" once there is at least one. Meta allows 10 rows; more → numbers.
      select count(*) into v_left from unnest(v_products) x where not (x = any (p_s.products));
      if v_left + (case when cardinality(p_s.products) > 0 then 1 else 0 end) <= 10 then
        if cardinality(p_s.products) > 0 then
          v_body := v_pre || 'Added ✔ ' || array_to_string(p_s.products, ', ') || E'\n\n' || 'Pick another, or tap ✅ Done.';
        else
          v_body := v_body || E'\n\n' || 'Tap “' || left(v_label, 20) || '” and pick one. You can add more after.';
        end if;
        select coalesce(jsonb_agg(r order by o), '[]'::jsonb) into v_rows from (
          select 0 as o, jsonb_build_object('id', 'bot_done', 'title', '✅ Done', 'description', 'Continue') as r
          where cardinality(p_s.products) > 0
          union all
          select n, jsonb_strip_nulls(jsonb_build_object('id', 'bot_p:' || n, 'title', left(x, 24),
                                                         'description', case when length(x) > 24 then x end))
          from unnest(v_products) with ordinality as u (x, n) where not (x = any (p_s.products))) t;
        perform private.wa_bot_say(p_s, p_lead, v_body, jsonb_build_object(
          'type', 'list',
          'body', jsonb_build_object('text', left(v_body, 1024)),
          'action', jsonb_build_object('button', left(v_label, 20), 'sections', jsonb_build_array(
            jsonb_build_object('title', left(v_label, 24), 'rows', v_rows)))));
      else
        v_body := v_body || E'\n\n' || 'Reply with the numbers, for example 1, 3' || E'\n' || v_list;
        perform private.wa_bot_say(p_s, p_lead, v_body);
      end if;
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
                then E'\n\nOur brochure: {brochure}' else '' end
        || case when private.wa_bot_text('website_url', null) is not null
                     and position('{website}' in coalesce(private.wa_bot_text('intro_text', ''), '')) = 0
                then case when private.wa_bot_text('brochure_url', null) is not null then E'\n' else E'\n\n' end
                     || 'Our website: {website}' else '' end,
        private.wa_bot_vars(v_s)),
      null, coalesce(private.wa_bot_text('brochure_url', null), private.wa_bot_text('website_url', null)) is not null);
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
        perform private.wa_bot_ask(v_s, v_lead, private.wa_bot_text('sorry_text', 'Sorry, I didn''t get that.'));
        v_n := 1;
      end if;
    end if;
  end if;

  return v_n;
end;
$$;

