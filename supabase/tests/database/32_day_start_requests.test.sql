-- Start the day away from the office with the admin's OK; sales executives have a day too
-- (owner, 02/11/2026). Asking, answering (a "no" needs a note), starting with an approved request,
-- who sees what, and what stays BDM-only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

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

insert into public.app_settings (section, value) values ('bdm', '{}')
on conflict (section) do nothing;
update public.app_settings set value = value || '{"require_selfie": true, "late_start_time": "23:59", "auto_end_time": "23:59"}'::jsonb
where section = 'bdm';

insert into auth.users (id, email) values
  ('32323232-0000-4000-a000-00000000000a', 'ds-admin@staff.invalid'),
  ('32323232-0000-4000-a000-0000000000d1', 'ds-bdm@staff.invalid'),
  ('32323232-0000-4000-a000-0000000000c1', 'ds-sales@staff.invalid'),
  ('32323232-0000-4000-a000-0000000000b1', 'ds-rec@staff.invalid');
insert into public.offices (id, name, lat, lng, radius_m) values
  ('32323232-1111-4000-a000-000000000001', 'Day Start Office', 12.9716, 77.5946, 100);
insert into public.staff (id, role, full_name, username, office_id) values
  ('32323232-0000-4000-a000-00000000000a', 'admin', 'Ds Admin', 'dsadmin', null),
  ('32323232-0000-4000-a000-0000000000d1', 'bdm', 'Ds Bdm', 'dsbdm', '32323232-1111-4000-a000-000000000001'),
  ('32323232-0000-4000-a000-0000000000c1', 'sales_executive', 'Ds Sales', 'dssales', '32323232-1111-4000-a000-000000000001'),
  ('32323232-0000-4000-a000-0000000000b1', 'receptionist', 'Ds Rec', 'dsrec', null);
insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, status, owner_staff_id, uploaded_at) values
  ('32323232-7777-4000-a000-000000000001', 'private', 'selfie/test/ds1.webp', 'selfie', 'image/webp', 50000, 'uploaded', '32323232-0000-4000-a000-0000000000d1', now()),
  ('32323232-7777-4000-a000-000000000002', 'private', 'selfie/test/ds2.webp', 'selfie', 'image/webp', 50000, 'uploaded', '32323232-0000-4000-a000-0000000000c1', now());

-- Who may ask.
select pg_temp.login('32323232-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.day_start_request('{"client_id":"32323232-2222-4000-a000-000000000009","lat":12.98,"lng":77.59,"reason":"x"}') $$,
  'P0001', 'not_allowed', 'a receptionist has no day to start');

-- A BDM a kilometre away: refused, then asks.
select pg_temp.login('32323232-0000-4000-a000-0000000000d1');
select throws_ok($$ select public.bdm_start_day('{"client_id":"32323232-3333-4000-a000-000000000001","lat":12.9806,"lng":77.5946,
  "selfie_file_id":"32323232-7777-4000-a000-000000000001"}') $$, 'P0001', 'outside_office', 'a kilometre away: refused');
select throws_ok($$ select public.day_start_request('{"client_id":"32323232-2222-4000-a000-000000000001","lat":12.9806,"lng":77.5946,"reason":"  "}') $$,
  'P0001', 'invalid_input', 'asking needs a reason');
select is(public.day_start_request('{"client_id":"32323232-2222-4000-a000-000000000001","lat":12.9806,"lng":77.5946,"accuracy":15,
  "reason":"Meeting at City Hospital first"}') ->> 'status', 'pending', 'the request waits for the admin');
select ok((select distance_m between 950 and 1050 from public.day_start_requests where id = '32323232-2222-4000-a000-000000000001'),
  'it keeps how far from the office it was');
select is(public.day_start_request('{"client_id":"32323232-2222-4000-a000-000000000001","lat":12.9806,"lng":77.5946,"reason":"again"}') ->> 'repeat',
  'true', 'sending the same request again gives it back');
select is(public.day_start_request('{"client_id":"32323232-2222-4000-a000-000000000002","lat":12.9806,"lng":77.5946,"reason":"again"}') ->> 'id',
  '32323232-2222-4000-a000-000000000001', 'one open request a day: asking again gives the open one');
select is((public.bdm_today() -> 'start_request' ->> 'status'), 'pending', 'the phone sees it waiting');
select throws_ok($$ select public.day_start_decide('32323232-2222-4000-a000-000000000001', true) $$,
  'P0001', 'not_allowed', 'a BDM cannot approve');
select throws_ok($$ insert into public.day_start_requests (id, staff_id, work_date, lat, lng, reason, status)
  values (gen_random_uuid(), '32323232-0000-4000-a000-0000000000d1', current_date, 1, 1, 'x', 'approved') $$,
  '42501', null, 'no writing the table directly');

reset role;
select is((select count(*) from public.notifications n join public.staff s on s.id = n.recipient_id
           where s.id = '32323232-0000-4000-a000-00000000000a' and n.type = 'day_start_request'
             and n.title = 'Ds Bdm asks to start the day away from the office' and n.body like 'Meeting at City Hospital first · 1.0 km from Day Start Office'),
  1::bigint, 'the admin is told, once, with the reason and the distance');

-- The admin approves; the BDM starts where they are.
select pg_temp.login('32323232-0000-4000-a000-00000000000a');
select is(public.day_start_decide('32323232-2222-4000-a000-000000000001', true) ->> 'status', 'approved', 'the admin approves');
select is(public.day_start_decide('32323232-2222-4000-a000-000000000001', true) ->> 'repeat', 'true', 'approving twice is harmless');
reset role;
select is((select title from public.notifications where recipient_id = '32323232-0000-4000-a000-0000000000d1' and type = 'day_start_decision'),
  'You can start the day where you are', 'the BDM is told');
select pg_temp.login('32323232-0000-4000-a000-0000000000d1');
select ok((public.bdm_start_day('{"client_id":"32323232-3333-4000-a000-000000000001","lat":12.9806,"lng":77.5946,
  "selfie_file_id":"32323232-7777-4000-a000-000000000001"}') -> 'day' -> 'flags') ? 'started_away_approved',
  'with the approval the day starts away from the office, and says so');
select is((select status from public.day_start_requests where id = '32323232-2222-4000-a000-000000000001'), 'used', 'the approval is used up');
select throws_ok($$ select public.day_start_request('{"client_id":"32323232-2222-4000-a000-000000000003","lat":12.98,"lng":77.59,"reason":"x"}') $$,
  'P0001', 'day_already_started', 'no asking once the day has started');

-- A sales executive: same rule; a "no" needs a note and is sent back.
select pg_temp.login('32323232-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.bdm_start_day('{"client_id":"32323232-3333-4000-a000-000000000002","lat":12.9806,"lng":77.5946,
  "selfie_file_id":"32323232-7777-4000-a000-000000000002"}') $$, 'P0001', 'outside_office', 'a sales executive away from the office: refused');
select lives_ok($$ select public.day_start_request('{"client_id":"32323232-2222-4000-a000-000000000004","lat":12.9806,"lng":77.5946,
  "reason":"Working from home today"}') $$, 'a sales executive asks');
select pg_temp.login('32323232-0000-4000-a000-00000000000a');
select throws_ok($$ select public.day_start_decide('32323232-2222-4000-a000-000000000004', false, ' ') $$,
  'P0001', 'invalid_input', 'saying no needs a note');
select is(public.day_start_decide('32323232-2222-4000-a000-000000000004', false, 'Please come to the office') ->> 'decline_note',
  'Please come to the office', 'the admin says no, with a note');
select is(jsonb_array_length(public.day_start_requests_list()), 2, 'the admin sees both requests');
select pg_temp.login('32323232-0000-4000-a000-0000000000c1');
select is(public.bdm_today() -> 'start_request' ->> 'decline_note', 'Please come to the office', 'the phone shows the note');
select is((select count(*) from public.day_start_requests), 1::bigint, 'a sales executive sees only their own requests');
select is(public.bdm_start_day('{"client_id":"32323232-3333-4000-a000-000000000002","lat":12.9720,"lng":77.5946,
  "selfie_file_id":"32323232-7777-4000-a000-000000000002"}') ->> 'inside', 'true', 'at the office the sales executive starts the day');
select throws_ok($$ select public.bdm_travel_start('{"client_id":"32323232-4444-4000-a000-000000000001","destination":"X","lat":12.97,"lng":77.59}') $$,
  'P0001', 'not_allowed', 'travel and visits stay BDM-only');

select * from finish();
rollback;
