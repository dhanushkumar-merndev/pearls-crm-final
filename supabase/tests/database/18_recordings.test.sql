-- Call recordings and voice notes: register from the phone (idempotent), who sees them,
-- manager "Request sync", attaching the uploaded file, upload modes.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(24);

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
  ('18181818-0000-4000-a000-00000000000a', 'rc-admin@staff.invalid'),
  ('18181818-0000-4000-a000-0000000000b1', 'rc-rec@staff.invalid'),
  ('18181818-0000-4000-a000-0000000000c1', 'rc-sales@staff.invalid'),
  ('18181818-0000-4000-a000-0000000000c2', 'rc-sales2@staff.invalid'),
  ('18181818-0000-4000-a000-0000000000c3', 'rc-mgr@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('18181818-0000-4000-a000-00000000000a', 'admin', 'Rc Admin', 'rcadmin'),
  ('18181818-0000-4000-a000-0000000000b1', 'receptionist', 'Rc Rec', 'rcrec'),
  ('18181818-0000-4000-a000-0000000000c1', 'sales_executive', 'Rc Sales', 'rcsales'),
  ('18181818-0000-4000-a000-0000000000c2', 'sales_executive', 'Rc Sales Two', 'rcsales2'),
  ('18181818-0000-4000-a000-0000000000c3', 'sales_manager', 'Rc Manager', 'rcmgr');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('18181818-2222-4000-a000-000000000001', 'RCTEST-1', 'Recording Patient', '+919811800001');
insert into public.leads (id, name, phone_e164, assigned_to, patient_id) values
  ('18181818-5555-4000-a000-000000000001', 'Recording Lead', '+919811800001', '18181818-0000-4000-a000-0000000000c1',
   '18181818-2222-4000-a000-000000000001');
insert into public.call_logs (id, staff_id, lead_id, patient_id, phone_e164, direction, started_at, duration_s, outcome, source) values
  ('18181818-6666-4000-a000-000000000001', '18181818-0000-4000-a000-0000000000c1', '18181818-5555-4000-a000-000000000001',
   '18181818-2222-4000-a000-000000000001', '+919811800001', 'outgoing', now() - interval '1 hour', 840, 'connected', 'app');
insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, status, owner_staff_id, uploaded_at) values
  ('18181818-7777-4000-a000-000000000001', 'private', 'call_recording/test/rc1.m4a', 'call_recording', 'audio/mp4', 900000,
   'uploaded', '18181818-0000-4000-a000-0000000000c1', now()),
  ('18181818-7777-4000-a000-000000000002', 'private', 'call_recording/test/rc2.m4a', 'call_recording', 'audio/mp4', 900000,
   'uploaded', '18181818-0000-4000-a000-0000000000c1', now()),
  ('18181818-7777-4000-a000-000000000003', 'private', 'call_recording/test/rc3.m4a', 'call_recording', 'audio/mp4', 900000,
   'pending', '18181818-0000-4000-a000-0000000000c1', null);

-- The phone registers the recording it matched to the call.
select pg_temp.login('18181818-0000-4000-a000-0000000000c1');
create temp table reg as
select public.recording_register(jsonb_build_array(jsonb_build_object(
  'id', '18181818-8888-4000-a000-000000000001', 'kind', 'call', 'call_log_id', '18181818-6666-4000-a000-000000000001',
  'recorded_at', now() - interval '1 hour', 'duration_s', 840, 'match_confidence', 0.95))) as r;
select is((select (r ->> 'registered')::int from reg), 1, 'registered once');
select is((select r ->> 'mode' from reg), 'sync_only', 'default mode: upload only when asked');
select is((select (r ->> 'max_seconds')::int from reg), 600, 'default: first 10 minutes');
select is((public.recording_register(jsonb_build_array(jsonb_build_object(
  'id', '18181818-8888-4000-a000-000000000001', 'kind', 'call', 'recorded_at', now())))) ->> 'registered', '0',
  'sending it again changes nothing');
select pg_temp.login(null);
select is((select recording_id::text from public.call_logs where id = '18181818-6666-4000-a000-000000000001'),
  '18181818-8888-4000-a000-000000000001', 'the call points at its recording');
select is((select lead_id::text || '/' || patient_id::text from public.recordings where id = '18181818-8888-4000-a000-000000000001'),
  '18181818-5555-4000-a000-000000000001/18181818-2222-4000-a000-000000000001', 'lead and patient come from the call');

-- Someone else can't attach to another person's call or lead.
select pg_temp.login('18181818-0000-4000-a000-0000000000c2');
select public.recording_register(jsonb_build_array(jsonb_build_object(
  'id', '18181818-8888-4000-a000-000000000002', 'kind', 'call', 'call_log_id', '18181818-6666-4000-a000-000000000001',
  'lead_id', '18181818-5555-4000-a000-000000000001', 'recorded_at', now())));
select pg_temp.login(null);
select is((select coalesce(call_log_id::text, '-') || '/' || coalesce(lead_id::text, '-') from public.recordings
           where id = '18181818-8888-4000-a000-000000000002'), '-/-', 'no link to calls or leads that are not yours');

-- Who sees what.
select pg_temp.login('18181818-0000-4000-a000-0000000000c2');
select is((select count(*) from public.recordings where id = '18181818-8888-4000-a000-000000000001'), 0::bigint,
  'another executive does not see it');
select is(jsonb_array_length(public.recordings_list(jsonb_build_object('lead_id', '18181818-5555-4000-a000-000000000001')) -> 'items'),
  0, 'nor in the list');
select pg_temp.login('18181818-0000-4000-a000-0000000000b1');
select is((select count(*) from public.recordings where id = '18181818-8888-4000-a000-000000000001'), 0::bigint,
  'reception does not see recordings by default');
select pg_temp.login('18181818-0000-4000-a000-0000000000c3');
select is((public.recordings_list(jsonb_build_object('lead_id', '18181818-5555-4000-a000-000000000001')) -> 'items' -> 0 ->> 'lead_name'),
  'Recording Lead', 'the manager sees it with the lead name');

-- Request sync: managers only; the owner gets a notification and the phone a task.
select pg_temp.login('18181818-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.request_recording_sync('18181818-8888-4000-a000-000000000001') $$, 'P0001', 'not_allowed',
  'executives cannot request sync');
select pg_temp.login('18181818-0000-4000-a000-0000000000c3');
select is(public.request_recording_sync('18181818-8888-4000-a000-000000000001') ->> 'status', 'queued', 'requested → queued');
select public.request_recording_sync('18181818-8888-4000-a000-000000000001');
select pg_temp.login(null);
select is((select count(*) from public.notifications where recipient_id = '18181818-0000-4000-a000-0000000000c1'
           and type = 'recording_sync'), 1::bigint, 'one notification, even when asked twice the same day');
select pg_temp.login('18181818-0000-4000-a000-0000000000c1');
select is(public.recording_tasks() -> 'requested', '["18181818-8888-4000-a000-000000000001"]'::jsonb, 'the phone sees the request');

-- Upload done: attach the file.
select throws_ok($$ select public.recording_attach('18181818-8888-4000-a000-000000000001', '18181818-7777-4000-a000-000000000003', 600, true) $$,
  'P0001', 'not_found', 'a file that is not uploaded yet is refused');
select is(public.recording_attach('18181818-8888-4000-a000-000000000001', '18181818-7777-4000-a000-000000000001', 600, true) ->> 'status',
  'synced', 'attached → synced');
select is(public.recording_attach('18181818-8888-4000-a000-000000000001', '18181818-7777-4000-a000-000000000001', 600, true) ->> 'uploaded_s',
  '600', 'attaching the same file again is fine (retry)');
select throws_ok($$ select public.recording_attach('18181818-8888-4000-a000-000000000001', '18181818-7777-4000-a000-000000000002', 600, true) $$,
  'P0001', 'duplicate', 'a second file for the same recording is refused');
select is(public.recording_tasks() -> 'requested', '[]'::jsonb, 'nothing left to sync');

-- The manager may open the audio; another executive may not.
select pg_temp.login('18181818-0000-4000-a000-0000000000c3');
select is((select count(*) from public.files_viewable(array['18181818-7777-4000-a000-000000000001'::uuid])), 1::bigint,
  'the manager can play it');
select pg_temp.login('18181818-0000-4000-a000-0000000000c2');
select is((select count(*) from public.files_viewable(array['18181818-7777-4000-a000-000000000001'::uuid])), 0::bigint,
  'another executive cannot');

-- Admin override → every call uploads; a lost-lead voice note is linked to the lead.
select pg_temp.login(null);
update public.staff set recording_upload_override = 'all_calls' where id = '18181818-0000-4000-a000-0000000000c1';
insert into public.lookup_values (id, kind, label) values ('18181818-9999-4000-a000-000000000001', 'lost_reason', 'Rc too costly');
update public.leads set stage = 'lost', lost_reason_id = '18181818-9999-4000-a000-000000000001'
 where id = '18181818-5555-4000-a000-000000000001';
select pg_temp.login('18181818-0000-4000-a000-0000000000c1');
select is(public.recording_register(jsonb_build_array(jsonb_build_object(
  'id', '18181818-8888-4000-a000-000000000003', 'kind', 'voice_note', 'lead_id', '18181818-5555-4000-a000-000000000001',
  'recorded_at', now(), 'duration_s', 25, 'lost_note', true))) ->> 'mode', 'all_calls', 'the override wins');
select pg_temp.login(null);
select is((select lost_recording_id::text from public.leads where id = '18181818-5555-4000-a000-000000000001'),
  '18181818-8888-4000-a000-000000000003', 'the voice note explains why the lead was lost');

select * from finish();
rollback;
