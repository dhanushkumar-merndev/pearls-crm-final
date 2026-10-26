-- BDM field work: geofence day start, visits, chunks (idempotent), route estimates (pending →
-- retried → filled), breaks, heartbeat / locate now, watchdog alerts once, timeline, end day,
-- auto-end, report, dashboard, and who sees what.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(41);

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

create temp table today as select (private.ist(now()))::date as d;
grant select on today to authenticated;

-- Our own timings for this test (whatever the clinic's settings are).
insert into public.app_settings (section, value) values ('bdm', '{}')
on conflict (section) do nothing;
update public.app_settings set value = value || '{"require_selfie": true, "late_start_time": "23:59", "auto_end_time": "23:59",
  "no_heartbeat_alert_minutes": 15, "break_grace_minutes": 5, "long_route_factor": 1.5}'::jsonb where section = 'bdm';

insert into auth.users (id, email) values
  ('19191919-0000-4000-a000-00000000000a', 'bd-admin@staff.invalid'),
  ('19191919-0000-4000-a000-0000000000d1', 'bd-one@staff.invalid'),
  ('19191919-0000-4000-a000-0000000000d2', 'bd-two@staff.invalid'),
  ('19191919-0000-4000-a000-0000000000c1', 'bd-sales@staff.invalid');
insert into public.offices (id, name, lat, lng, radius_m) values
  ('19191919-1111-4000-a000-000000000001', 'BDM Test Office', 12.9716, 77.5946, 200);
insert into public.staff (id, role, full_name, username, office_id, bdm_start_anywhere) values
  ('19191919-0000-4000-a000-00000000000a', 'admin', 'Bd Admin', 'bdadmin', null, false),
  ('19191919-0000-4000-a000-0000000000d1', 'bdm', 'Bd One', 'bdone', '19191919-1111-4000-a000-000000000001', false),
  ('19191919-0000-4000-a000-0000000000d2', 'bdm', 'Bd Two', 'bdtwo', null, true),
  ('19191919-0000-4000-a000-0000000000c1', 'sales_executive', 'Bd Sales', 'bdsales', null, false);
insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, status, owner_staff_id, uploaded_at) values
  ('19191919-7777-4000-a000-000000000001', 'private', 'selfie/test/bd1.webp', 'selfie', 'image/webp', 50000, 'uploaded', '19191919-0000-4000-a000-0000000000d1', now()),
  ('19191919-7777-4000-a000-000000000002', 'private', 'selfie/test/bd2.webp', 'selfie', 'image/webp', 50000, 'uploaded', '19191919-0000-4000-a000-0000000000d2', now()),
  ('19191919-7777-4000-a000-000000000003', 'private', 'punch/test/bd1.webp', 'punch_photo', 'image/webp', 50000, 'uploaded', '19191919-0000-4000-a000-0000000000d1', now()),
  ('19191919-7777-4000-a000-000000000004', 'private', 'punch/test/bd1b.webp', 'punch_photo', 'image/webp', 50000, 'uploaded', '19191919-0000-4000-a000-0000000000d1', now());

-- Offices are admin master data.
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select throws_ok($$ insert into public.offices (name, lat, lng) values ('Mine', 1, 1) $$, '42501', null, 'a BDM cannot add an office');
select pg_temp.login('19191919-0000-4000-a000-00000000000a');
select lives_ok($$ update public.offices set radius_m = 200 where id = '19191919-1111-4000-a000-000000000001' $$, 'the admin edits offices');

-- Day start: selfie, then the geofence (200 m around the office).
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select throws_ok($$ select public.bdm_start_day('{"client_id":"19191919-2222-4000-a000-000000000001","lat":12.9716,"lng":77.5946}') $$,
  'P0001', 'selfie_required', 'a selfie is needed');
select throws_ok($$ select public.bdm_start_day('{"client_id":"19191919-2222-4000-a000-000000000001","lat":12.9806,"lng":77.5946,
  "selfie_file_id":"19191919-7777-4000-a000-000000000001"}') $$, 'P0001', 'outside_office', 'a kilometre from the office: refused');
select is((public.bdm_start_day('{"client_id":"19191919-2222-4000-a000-000000000001","lat":12.9725,"lng":77.5946,"accuracy":12,
  "selfie_file_id":"19191919-7777-4000-a000-000000000001"}') ->> 'inside')::boolean, true, '100 m from the office: started');
select is((public.bdm_start_day('{"client_id":"19191919-2222-4000-a000-000000000009","lat":12.9725,"lng":77.5946,
  "selfie_file_id":"19191919-7777-4000-a000-000000000001"}') ->> 'repeat')::boolean, true, 'starting again the same day gives the same day');
select is((select count(*) from public.bdm_days where staff_id = '19191919-0000-4000-a000-0000000000d1'), 1::bigint, 'one day per BDM per date');

select pg_temp.login('19191919-0000-4000-a000-0000000000d2');
select is((public.bdm_start_day('{"client_id":"19191919-2222-4000-a000-000000000002","lat":13.5,"lng":78.0,
  "selfie_file_id":"19191919-7777-4000-a000-000000000002"}') -> 'day' -> 'flags'), '["started_away"]'::jsonb,
  'allowed to start anywhere: started, and flagged');
select pg_temp.login('19191919-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.bdm_start_day('{"client_id":"19191919-2222-4000-a000-000000000003","lat":12.9716,"lng":77.5946}') $$,
  'P0001', 'not_allowed', 'only BDMs have days');

-- Travel and the track.
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select is(public.bdm_travel_start('{"client_id":"19191919-3333-4000-a000-000000000001","destination":"City Hospital","purpose":"Doctor tie-up",
  "lat":12.9725,"lng":77.5946}') ->> 'destination', 'City Hospital', 'travel started');
select is((select state::text from public.bdm_live_status where staff_id = '19191919-0000-4000-a000-0000000000d1'), 'travelling', 'the live map shows travelling');
select throws_ok($$ select public.bdm_travel_start('{"client_id":"19191919-3333-4000-a000-000000000002","destination":"Other","lat":1,"lng":1}') $$,
  'P0001', 'visit_open', 'one visit at a time');

create temp table chunks as select jsonb_build_array(
  jsonb_build_object('id', '19191919-4444-4000-a000-000000000001', 'day_id', '19191919-2222-4000-a000-000000000001', 'seq', 0,
    'started_at', now(), 'ended_at', now(), 'polyline', '_p~iF~ps|U_ulLnnqC', 'offsets', jsonb_build_array(0, 10),
    'accuracies', jsonb_build_array(8, 9), 'distance_m', 4000),
  jsonb_build_object('id', '19191919-4444-4000-a000-000000000002', 'day_id', '19191919-2222-4000-a000-000000000001', 'seq', 1,
    'started_at', now(), 'ended_at', now(), 'polyline', '_mqNvxq`@', 'offsets', jsonb_build_array(0),
    'accuracies', jsonb_build_array(10), 'distance_m', 2500)) as c;
grant select on chunks to authenticated;
select is(jsonb_array_length(public.bdm_upload_chunks((select c from chunks)) -> 'accepted'), 2, 'two chunks accepted');
select is(jsonb_array_length(public.bdm_upload_chunks((select c from chunks)) -> 'accepted'), 2, 'sending them again: same answer');
select is((select count(*) from public.location_chunks where day_id = '19191919-2222-4000-a000-000000000001'), 2::bigint, 'and still two rows');
select pg_temp.login('19191919-0000-4000-a000-0000000000d2');
select is(jsonb_array_length(public.bdm_upload_chunks(jsonb_build_array((select c -> 0 from chunks) || '{"id":"19191919-4444-4000-a000-000000000003","seq":9}'))
  -> 'accepted'), 0, 'nobody can add to another BDM''s day');

-- Reached → route estimate queued; ORS down → still pending, retried later; then filled.
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select is(public.bdm_reached('{"visit_id":"19191919-3333-4000-a000-000000000001","lat":12.9356,"lng":77.6245,"accuracy":9,
  "photo_file_id":"19191919-7777-4000-a000-000000000003"}') ->> 'estimate_status', 'pending', 'reached: estimate pending');
select pg_temp.login(null);
select ok(public.route_estimates_due(50) @> '[{"id":"19191919-3333-4000-a000-000000000001"}]', 'the estimator picks it up');
select public.route_estimate_save('19191919-3333-4000-a000-000000000001', false, null, null, 'ORS: HTTP 503');
select is((select estimate_status::text || '/' || estimate_attempts from public.site_visits where id = '19191919-3333-4000-a000-000000000001'),
  'pending/1', 'ORS down: still pending, one try counted');
select ok(not (public.route_estimates_due(50) @> '[{"id":"19191919-3333-4000-a000-000000000001"}]'), 'not asked again straight away');
select public.route_estimate_save('19191919-3333-4000-a000-000000000001', true, 4000, 14, null);
select is((select est_distance_m || '/' || actual_m || '/' || flag_long_route from public.site_visits where id = '19191919-3333-4000-a000-000000000001'),
  '4000/6500/true', 'filled later: 4 km estimated, 6.5 km driven → flagged as a long route');

-- A punch photo that uploaded later is attached to the visit.
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select is(public.bdm_attach_photo('19191919-3333-4000-a000-000000000001', '19191919-7777-4000-a000-000000000004') ->> 'punch_photo_file_id',
  '19191919-7777-4000-a000-000000000004', 'a late photo is attached');

-- Visit complete with a new lead (a retry never makes two).
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
create temp table done as select public.bdm_visit_complete('{"visit_id":"19191919-3333-4000-a000-000000000001","outcome":"Interested in tie-up",
  "contact_name":"Dr Rao","contact_phone":"+919811900001","interest":"hot",
  "create_lead":{"name":"Dr Rao referral","phone":"+919811900001","treatment_text":"Hair"}}') as r;
select isnt((select r ->> 'lead_id' from done), null, 'a lead was made');
select is((public.bdm_visit_complete('{"visit_id":"19191919-3333-4000-a000-000000000001","create_lead":{"name":"x","phone":"+919811900002"}}')
  ->> 'lead_id'), (select r ->> 'lead_id' from done), 'completing again changes nothing');
select pg_temp.login(null);
select is((select created_via from public.leads where id = (select (r ->> 'lead_id')::uuid from done)), 'bdm', 'the lead is marked as from a BDM');

-- Breaks.
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select is(public.bdm_break('{"client_id":"19191919-5555-4000-a000-000000000001","action":"start","planned_minutes":30}') ->> 'planned_minutes',
  '30', 'break started');
select throws_ok($$ select public.bdm_break('{"client_id":"19191919-5555-4000-a000-000000000002","action":"start"}') $$, 'P0001', 'break_open',
  'one break at a time');

-- Watchdog: silent for 16 minutes and a break 40 minutes long → one alert each, however often it runs.
select pg_temp.login(null);
insert into public.bdm_live_status (staff_id, state, last_heartbeat_at) values ('19191919-0000-4000-a000-0000000000d1', 'on_break', now() - interval '16 minutes')
on conflict (staff_id) do update set last_heartbeat_at = now() - interval '16 minutes';
update public.bdm_breaks set started_at = now() - interval '40 minutes' where id = '19191919-5555-4000-a000-000000000001';
select public.bdm_watchdog();
select public.bdm_watchdog();
select is((select count(*) from public.bdm_events where staff_id = '19191919-0000-4000-a000-0000000000d1' and kind = 'no_heartbeat'),
  1::bigint, 'no signal for 15+ minutes: one event');
select is((select count(*) from public.notifications where recipient_id = '19191919-0000-4000-a000-00000000000a'
           and title like 'Bd One: no signal%'), 1::bigint, 'and one alert for the admin');
select is((select count(*) from public.notifications where recipient_id = '19191919-0000-4000-a000-00000000000a'
           and title like 'Bd One: break over%'), 1::bigint, 'a long break: one alert');

-- Heartbeat and "locate now".
select pg_temp.login('19191919-0000-4000-a000-00000000000a');
select public.bdm_locate_now('19191919-0000-4000-a000-0000000000d1');
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select is((public.bdm_heartbeat('{"battery":54,"charging":false,"gps_on":true,"network":"4g","app_version":"0.1.0"}') ->> 'locate_now')::boolean,
  true, 'asked to send a location now');
select is((public.bdm_heartbeat('{"lat":12.9356,"lng":77.6245,"accuracy":8,"battery":54,"gps_on":true}') ->> 'locate_now')::boolean,
  false, 'answered with the location');
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select is(public.bdm_break('{"action":"end"}') ->> 'resume_state', 'travelling', 'break over: back to travelling');

-- Who sees what.
select pg_temp.login('19191919-0000-4000-a000-0000000000d2');
select is((select count(*) from public.bdm_days where staff_id = '19191919-0000-4000-a000-0000000000d1'), 0::bigint, 'BDMs see only their own days');
select throws_ok($$ select public.bdm_day_timeline('19191919-0000-4000-a000-0000000000d1', (select d from today)) $$, 'P0001', 'not_allowed',
  'nor another BDM''s timeline');
select pg_temp.login('19191919-0000-4000-a000-00000000000a');
select is(jsonb_array_length(public.bdm_day_timeline('19191919-0000-4000-a000-0000000000d1', (select d from today)) -> 'chunks'), 2,
  'the admin sees the whole route');

-- End of day: summary and trips.
select pg_temp.login('19191919-0000-4000-a000-0000000000d1');
select is(public.bdm_end_day('{"lat":12.9725,"lng":77.5946}') -> 'summary' ->> 'visits', '1', 'day ended with its summary');
select is((select distance_m || '/' || cardinality(polylines) from public.trips where site_visit_id = '19191919-3333-4000-a000-000000000001'),
  '6500/2', 'the trip to the visit: 6.5 km in two pieces');
select is((public.dashboard_bdm() -> 'today' ->> 'leads'), '1', 'My day counts the lead');

-- Auto-end: a day still open after the auto-end time.
select pg_temp.login(null);
update public.app_settings set value = value || '{"auto_end_time": "00:00"}'::jsonb where section = 'bdm';
select public.bdm_watchdog();
select is((select auto_ended::text || '/' || ('auto_ended' = any (flags))::text from public.bdm_days where id = '19191919-2222-4000-a000-000000000002'),
  'true/true', 'a forgotten day is ended and flagged');

select pg_temp.login('19191919-0000-4000-a000-00000000000a');
select ok(public.bdm_report((select d from today), (select d from today),
  array['19191919-0000-4000-a000-0000000000d1'::uuid]) @> '[{"name":"Bd One","visits":"1","km_actual":6.5,"km_estimated":4.0}]',
  'the Excel report has the day with km driven and estimated');

select * from finish();
rollback;
