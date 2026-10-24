-- Push notifications: a new notification for someone with a phone asks push-send to deliver it;
-- push-send's helpers are for the server only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

insert into auth.users (id, email) values
  ('17171717-0000-4000-a000-0000000000c1', 'push-sales@staff.invalid'),
  ('17171717-0000-4000-a000-0000000000c2', 'push-nophone@staff.invalid'),
  ('17171717-0000-4000-a000-0000000000c3', 'push-off@staff.invalid');
insert into public.staff (id, role, full_name, username, active, deactivated_at) values
  ('17171717-0000-4000-a000-0000000000c1', 'sales_executive', 'Push Sales', 'pushsales', true, null),
  ('17171717-0000-4000-a000-0000000000c2', 'sales_executive', 'Push No Phone', 'pushnophone', true, null),
  ('17171717-0000-4000-a000-0000000000c3', 'sales_executive', 'Push Off', 'pushoff', false, now());
insert into public.device_tokens (staff_id, token, platform, last_seen_at) values
  ('17171717-0000-4000-a000-0000000000c1', 'push-test-old', 'android', now() - interval '2 days'),
  ('17171717-0000-4000-a000-0000000000c1', 'push-test-new', 'android', now()),
  ('17171717-0000-4000-a000-0000000000c1', 'push-test-web', 'web', now()),
  ('17171717-0000-4000-a000-0000000000c3', 'push-test-off', 'android', now());

-- Each push request is either queued for pg_net or, when the Vault secrets are missing, logged as a failed job.
create function pg_temp.push_requests()
returns bigint
language sql
as $$
  select (select count(*) from net.http_request_queue where url like '%/push-send')
       + (select count(*) from public.job_runs where job = 'call_edge:push-send');
$$;

create temp table before_push as select pg_temp.push_requests() as n;
insert into public.notifications (id, recipient_id, type, title, body, link) values
  ('17171717-9999-4000-a000-000000000001', '17171717-0000-4000-a000-0000000000c1', 'lead_assigned', 'New lead: Asha', 'Call now', '/leads/x');
select is(pg_temp.push_requests() - (select n from before_push), 1::bigint, 'a notification for someone with a phone asks for one push');

delete from before_push;
insert into before_push select pg_temp.push_requests();
insert into public.notifications (recipient_id, type, title) values
  ('17171717-0000-4000-a000-0000000000c2', 'lead_assigned', 'New lead: Ravi');
select is(pg_temp.push_requests() - (select n from before_push), 0::bigint, 'nobody to ring without a phone');

select is(
  public.push_payload('17171717-9999-4000-a000-000000000001') -> 'tokens',
  '["push-test-new", "push-test-old"]'::jsonb,
  'the payload has the Android phones, most recently seen first (no web tokens)');
select is(public.push_payload('17171717-9999-4000-a000-000000000001') ->> 'title', 'New lead: Asha', 'title comes from the notification');
select is((public.push_payload('17171717-9999-4000-a000-000000000001') ->> 'read')::boolean, false, 'not read yet');

insert into public.notifications (id, recipient_id, type, title) values
  ('17171717-9999-4000-a000-000000000003', '17171717-0000-4000-a000-0000000000c3', 'lead_assigned', 'Old');
select is(public.push_payload('17171717-9999-4000-a000-000000000003') -> 'tokens', '[]'::jsonb, 'a switched-off login gets no push');
select is(public.push_payload('17171717-9999-4000-a000-0000000000ff'), null, 'unknown notification → nothing');

select is(public.push_tokens_drop(array['push-test-old', 'no-such-token']), 1, 'tokens Firebase forgot are removed');
select is((select count(*) from public.device_tokens where token like 'push-test-%'), 3::bigint, 'the others stay');

-- Staff logins can't read other people's tokens through these helpers.
select set_config('request.jwt.claims', json_build_object('sub', '17171717-0000-4000-a000-0000000000c1', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select public.push_payload('17171717-9999-4000-a000-000000000001') $$, '42501', null,
  'push_payload is for the server only');
reset role;

select * from finish();
rollback;
