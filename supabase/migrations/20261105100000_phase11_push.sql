-- Phase 11: push notifications to the Android app (PLAN.md E3 row 11).
-- A new row in public.notifications for someone with a registered phone asks the push-send
-- Edge Function (through pg_net, after commit) to deliver it with Firebase Cloud Messaging.
-- push-send reads what to send with push_payload and removes tokens Firebase no longer knows.

-- What push-send sends for one notification: the text and the recipient's Android tokens.
create function public.push_payload(p_id uuid)
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
      where d.staff_id = n.recipient_id and d.platform = 'android'), '[]'::jsonb))
  from public.notifications n where n.id = p_id;
$$;

-- Firebase said these tokens are gone (app uninstalled, data cleared): forget them.
create function public.push_tokens_drop(p_tokens text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.device_tokens where token = any (coalesce(p_tokens, '{}'::text[]));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- push-send logs each delivery here ("last push" for the admin; failures for support).
create function public.push_log_run(p_ok boolean, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.job_runs (job, finished_at, ok, detail) values ('push-send', now(), coalesce(p_ok, false), coalesce(p_detail, '{}'::jsonb));
$$;

revoke execute on function public.push_payload(uuid), public.push_tokens_drop(text[]), public.push_log_run(boolean, jsonb)
from public, anon, authenticated;
grant execute on function public.push_payload(uuid), public.push_tokens_drop(text[]), public.push_log_run(boolean, jsonb)
to service_role;

create function private.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.device_tokens d where d.staff_id = new.recipient_id and d.platform = 'android') then
    perform private.call_edge('push-send', jsonb_build_object('id', new.id));
  end if;
  return new;
end;
$$;

create trigger notifications_push
after insert on public.notifications
for each row execute function private.push_on_notification();

select private.lock_down_public_functions();
