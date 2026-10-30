-- Chat bot: a photo, voice note, video, file or sticker gets "I can only read typed messages"
-- (Admin → WhatsApp → Chat bot → media_text) and the question again, instead of "Sorry, I didn't
-- get that." It still counts as an answer it couldn't use (3 → the bot leaves it to staff), so
-- a stream of photos can't make it reply for ever. An emoji reaction is ignored.

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
