-- Browser pop-ups (Phase 20a): a notification for someone with only a browser registered asks
-- push-send too; the payload lists browsers apart from phones; locate_now never pops up; a browser
-- forgets only its own person's token on sign-out.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

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
  ('40404040-0000-4000-a000-0000000000a1', 'wp-admin@staff.invalid'),
  ('40404040-0000-4000-a000-0000000000b1', 'wp-rec@staff.invalid'),
  ('40404040-0000-4000-a000-0000000000d1', 'wp-bdm@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('40404040-0000-4000-a000-0000000000a1', 'admin', 'Wp Admin', 'wpadmin'),
  ('40404040-0000-4000-a000-0000000000b1', 'receptionist', 'Wp Rec', 'wprec'),
  ('40404040-0000-4000-a000-0000000000d1', 'bdm', 'Wp Bdm', 'wpbdm');
insert into public.device_tokens (staff_id, token, platform, last_seen_at) values
  ('40404040-0000-4000-a000-0000000000b1', 'wp-web-old', 'web', now() - interval '1 day'),
  ('40404040-0000-4000-a000-0000000000b1', 'wp-web-new', 'web', now()),
  ('40404040-0000-4000-a000-0000000000d1', 'wp-bdm-phone', 'android', now()),
  ('40404040-0000-4000-a000-0000000000d1', 'wp-bdm-web', 'web', now());

create function pg_temp.push_requests()
returns bigint
language sql
as $$
  select (select count(*) from net.http_request_queue where url like '%/push-send')
       + (select count(*) from public.job_runs where job = 'call_edge:push-send');
$$;

create temp table before_push as select pg_temp.push_requests() as n;
insert into public.notifications (id, recipient_id, type, title, body, link) values
  ('40404040-9999-4000-a000-000000000001', '40404040-0000-4000-a000-0000000000b1', 'registration_pending',
   'New self-registration', 'Asha', '/patients/registrations');
select is(pg_temp.push_requests() - (select n from before_push), 1::bigint,
  'reception with only a browser registered: the notification asks for a push');

select is(public.push_payload('40404040-9999-4000-a000-000000000001') -> 'web_tokens', '["wp-web-new", "wp-web-old"]'::jsonb,
  'the payload lists the browsers, most recently seen first');
select is(public.push_payload('40404040-9999-4000-a000-000000000001') -> 'tokens', '[]'::jsonb,
  'and no phones (reception has none)');

-- locate_now: the BDM's phone answers it; a browser never shows it.
delete from before_push;
insert into before_push select pg_temp.push_requests();
insert into public.notifications (id, recipient_id, type, title) values
  ('40404040-9999-4000-a000-000000000002', '40404040-0000-4000-a000-0000000000d1', 'locate_now', 'Locate');
select is(pg_temp.push_requests() - (select n from before_push), 1::bigint, 'locate_now still goes to the phone');
select is(public.push_payload('40404040-9999-4000-a000-000000000002') -> 'web_tokens', '[]'::jsonb,
  'but not to the BDM''s browser');
select is(public.push_payload('40404040-9999-4000-a000-000000000002') -> 'tokens', '["wp-bdm-phone"]'::jsonb,
  'the phone is in the payload');

-- Signing in registers this browser; signing out forgets it — only one's own.
select pg_temp.login('40404040-0000-4000-a000-0000000000a1');
select lives_ok($$ select public.register_device('wp-admin-web', 'web', 'web') $$, 'admin turns pop-ups on for this browser');
select is(public.unregister_device('wp-web-new'), false, 'someone else''s browser token is left alone');
select is(public.unregister_device('wp-admin-web'), true, 'signing out forgets this browser');
select throws_ok($$ select public.unregister_device('') $$, 'P0001', 'invalid_input', 'an empty token is refused');
-- "Send a test": a notification to oneself, not twice within 20 seconds.
select isnt(public.push_test(), null, 'send a test makes a notification');
select is((select (recipient_id, type, link)::text from public.notifications where type = 'push_test'
            and recipient_id = '40404040-0000-4000-a000-0000000000a1'),
  '(40404040-0000-4000-a000-0000000000a1,push_test,/notifications)', 'to oneself, opening the notifications page');
select throws_ok($$ select public.push_test() $$, 'P0001', 'rate_limited', 'a second test right away is refused');
select pg_temp.login(null);
select is((select count(*)::int from public.device_tokens where token in ('wp-web-new', 'wp-admin-web')), 1,
  'reception''s token stays; the admin''s is gone');

select * from finish();
rollback;
