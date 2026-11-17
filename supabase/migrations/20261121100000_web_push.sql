-- Phase 20a (owner 17/11/2026): bell notifications also pop up on the computer (browser push), for
-- admin, reception, sales managers — anyone who turns it on for that browser. Same Firebase project as
-- the phone. A browser registers its token with register_device(token, 'web') (the table took 'web'
-- since the start) and forgets it on sign-out with unregister_device, so a shared reception computer
-- never shows the previous person's notifications.

-- What push-send sends for one notification: Android phones in "tokens" (as before) and browsers in
-- "web_tokens". locate_now is a command to the BDM's phone, never a pop-up.
create or replace function public.push_payload(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', n.id, 'type', n.type, 'title', n.title, 'body', coalesce(n.body, ''), 'link', n.link,
    'read', n.read_at is not null,
    'tokens', coalesce((
      select jsonb_agg(d.token order by d.last_seen_at desc)
      from public.device_tokens d
      join public.staff s on s.id = d.staff_id and s.active
      where d.staff_id = n.recipient_id and d.platform = 'android'), '[]'::jsonb),
    'web_tokens', coalesce((
      select jsonb_agg(d.token order by d.last_seen_at desc)
      from public.device_tokens d
      join public.staff s on s.id = d.staff_id and s.active
      where d.staff_id = n.recipient_id and d.platform = 'web' and n.type <> 'locate_now'), '[]'::jsonb))
  from public.notifications n where n.id = p_id;
$$;

-- A saved notification rings the phone / pops up on the computer (push-send) and/or emails
-- (notify-email) by its rule. locate_now: phones only, always pushed, never emailed.
create or replace function private.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_push boolean;
  v_email boolean;
begin
  select c.push, c.email into v_push, v_email from private.notification_channels(new.type) c;
  if (new.type = 'locate_now'
        and exists (select 1 from public.device_tokens d where d.staff_id = new.recipient_id and d.platform = 'android'))
     or (v_push and new.type <> 'locate_now'
        and exists (select 1 from public.device_tokens d where d.staff_id = new.recipient_id)) then
    perform private.call_edge('push-send', jsonb_build_object('id', new.id));
  end if;
  if v_email and new.type <> 'locate_now'
     and exists (select 1 from public.staff s where s.id = new.recipient_id and s.active and s.email is not null) then
    perform private.call_edge('notify-email', jsonb_build_object('id', new.id));
  end if;
  return new;
end;
$$;

-- Turning pop-ups off, or signing out: this browser stops getting the signed-in person's
-- notifications. Only one's own token; true when one was removed.
create function public.unregister_device(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
begin
  if p_token is null or length(p_token) not between 1 and 4096 then
    perform private.fail('invalid_input');
  end if;
  delete from public.device_tokens where token = p_token and staff_id = v_id;
  return found;
end;
$$;
grant execute on function public.unregister_device(text) to authenticated;

-- "Send a test" on the Notifications page: a notification to oneself, so pop-ups (and the phone) can be
-- checked. At most one every 20 seconds.
create function public.push_test()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
  v_n uuid;
begin
  if exists (select 1 from public.notifications
             where recipient_id = v_id and type = 'push_test' and created_at > now() - interval '20 seconds') then
    perform private.fail('rate_limited');
  end if;
  insert into public.notifications (recipient_id, type, title, body, link)
  values (v_id, 'push_test', 'Test notification', 'Pop-ups work on this computer.', '/notifications')
  returning id into v_n;
  return v_n;
end;
$$;
grant execute on function public.push_test() to authenticated;

select private.lock_down_public_functions();
