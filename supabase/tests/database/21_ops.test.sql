-- Phase 14: notification rules (push / email), storage meter, housekeeping, backups (resume,
-- SHA-256 verify, re-check catches a changed copy), purge refuses anything without a verified
-- backup, full export paging, backup reminder, sales targets, admin dashboard, daily summary.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(64);

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
create temp table ids (k text primary key, v text);
grant select, insert, update on ids to authenticated;

-- A clean slate for what this test measures (all rolled back).
update public.backup_batches set status = 'abandoned' where status = 'running';
delete from public.job_runs where job = 'daily-summary';
insert into public.app_settings (section, value) values ('storage', '{}'), ('notifications', '{}'), ('sales', '{}')
on conflict (section) do nothing;

insert into auth.users (id, email) values
  ('21212121-0000-4000-a000-00000000000a', 'ops-admin@staff.invalid'),
  ('21212121-0000-4000-a000-0000000000b1', 'ops-rec@staff.invalid'),
  ('21212121-0000-4000-a000-0000000000c1', 'ops-sales@staff.invalid'),
  ('21212121-0000-4000-a000-0000000000c2', 'ops-sales2@staff.invalid'),
  ('21212121-0000-4000-a000-0000000000c3', 'ops-manager@staff.invalid'),
  ('21212121-0000-4000-a000-0000000000d1', 'ops-bdm@staff.invalid');
insert into public.staff (id, role, full_name, username, email) values
  ('21212121-0000-4000-a000-00000000000a', 'admin', 'Ops Admin', 'opsadmin', 'ops-admin@example.com'),
  ('21212121-0000-4000-a000-0000000000b1', 'receptionist', 'Ops Rec', 'opsrec', null),
  ('21212121-0000-4000-a000-0000000000c1', 'sales_executive', 'Ops Sales', 'opssales', null),
  ('21212121-0000-4000-a000-0000000000c2', 'sales_executive', 'Ops Sales Two', 'opssales2', null),
  ('21212121-0000-4000-a000-0000000000c3', 'sales_manager', 'Ops Manager', 'opsmanager', null),
  ('21212121-0000-4000-a000-0000000000d1', 'bdm', 'Ops Bdm', 'opsbdm', null);

------------------------------------------------------------------------------
-- Notification rules
------------------------------------------------------------------------------
select is((select row(push, email)::text from private.notification_channels('lead_assigned')), '(t,f)',
  'by default a notification rings the phone and sends no email');
select is((select row(push, email)::text from private.notification_channels('storage_alert')), '(t,t)',
  'storage alerts also email by default');
select is((select push from private.notification_channels('daily_summary')), false, 'the daily summary does not ring phones');

select pg_temp.login('21212121-0000-4000-a000-0000000000b1');
select throws_ok($$ insert into public.notification_rules (type, push, email) values ('lead_assigned', false, true) $$,
  '42501', null, 'reception cannot change notification rules');
select pg_temp.login('21212121-0000-4000-a000-00000000000a');
select lives_ok($$ insert into public.notification_rules (type, push, email) values ('lead_assigned', false, true)
                   on conflict (type) do update set push = excluded.push, email = excluded.email $$, 'the admin sets a rule');
reset role;
select is((select row(push, email)::text from private.notification_channels('lead_assigned')), '(f,t)', 'the rule decides the channels');

-- Email goes through notify-email only when the rule asks and the person has an address.
reset role;
create temp table q0 as select coalesce(max(id), 0) as id from net.http_request_queue;
insert into public.notifications (recipient_id, type, title) values
  ('21212121-0000-4000-a000-00000000000a', 'lead_assigned', 'emailed'),
  ('21212121-0000-4000-a000-0000000000b1', 'lead_assigned', 'no address');
select is((select count(*)::int from net.http_request_queue q where q.id > (select id from q0) and q.url like '%/notify-email'), 1,
  'only the recipient with an email address gets the email');
select is((select (convert_from(body, 'UTF8')::jsonb ->> 'id') from net.http_request_queue q where q.id > (select id from q0) and q.url like '%/notify-email'),
  (select id::text from public.notifications where title = 'emailed'), 'the email names the notification');
select is((public.email_payload((select id from public.notifications where title = 'emailed'))) ->> 'to_email', 'ops-admin@example.com',
  'email_payload gives the address');
select pg_temp.login('21212121-0000-4000-a000-00000000000a');
select is((public.admin_update_staff('21212121-0000-4000-a000-0000000000b1', '{"email": " Rec@Example.com "}')).email, 'rec@example.com',
  'the admin adds a contact email to an existing login');
select is((public.admin_update_staff('21212121-0000-4000-a000-0000000000b1', '{"email": ""}')).email, null, 'and can clear it');
reset role;

------------------------------------------------------------------------------
-- Storage meter and housekeeping
------------------------------------------------------------------------------
update public.app_settings set value = value || '{"monthly_writes_limit": 1000}'::jsonb where section = 'storage';
insert into public.usage_counters (month, metric, value) values (date_trunc('month', private.ist(now()))::date, 'tigris_writes', 990)
on conflict (month, metric) do update set value = public.usage_counters.value + 990;

select pg_temp.login('21212121-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.storage_meter() $$, 'P0001', 'not_allowed', 'only the admin sees the storage meter');
select pg_temp.login('21212121-0000-4000-a000-00000000000a');
select is((public.storage_meter()) ->> 'level', 'critical', '99% of the monthly writes → critical');
select ok((public.storage_meter()) ? 'by_purpose' and ((public.storage_meter()) ->> 'db_bytes')::bigint > 0, 'database size and files by kind');

reset role;
insert into public.job_runs (job, started_at) values ('ops-old', now() - interval '100 days'), ('ops-new', now() - interval '10 days');
insert into public.idempotency_keys (key, fn, created_at) values ('21212121-9999-4000-a000-000000000001', 'ops', now() - interval '8 days');
insert into public.client_errors (app, message, at) values ('web', 'ops-old', now() - interval '31 days'), ('web', 'ops-new', now());
insert into public.bdm_days (id, staff_id, work_date, started_at, ended_at, state, summary) values
  ('21212121-8888-4000-a000-000000000001', '21212121-0000-4000-a000-0000000000d1', (select d from today) - 40, now() - interval '40 days',
   now() - interval '40 days', 'off_duty', '{"distance_m": 1234}'),
  ('21212121-8888-4000-a000-000000000002', '21212121-0000-4000-a000-0000000000d1', (select d from today) - 5, now() - interval '5 days',
   now() - interval '5 days', 'off_duty', '{"distance_m": 99}');
insert into public.location_chunks (id, day_id, staff_id, seq, started_at, ended_at, points, polyline, offsets, accuracies, distance_m)
select gen_random_uuid(), d.id, d.staff_id, 0, d.started_at, d.started_at, 1, '_p~iF~ps|U', '{0}', '{5}', 0
from public.bdm_days d where d.staff_id = '21212121-0000-4000-a000-0000000000d1';
select private.housekeeping();
select is((select string_agg(job, ',' order by job) from public.job_runs where job like 'ops-%'), 'ops-new', 'job runs older than 90 days go');
select is((select count(*)::int from public.idempotency_keys where fn = 'ops'), 0, 'idempotency keys older than 7 days go');
select is((select string_agg(message, ',') from public.client_errors where message like 'ops-%'), 'ops-new', 'client errors older than 30 days go');
select is((select count(*)::int from public.location_chunks where staff_id = '21212121-0000-4000-a000-0000000000d1'), 1,
  'GPS chunks of days over 30 days old go; recent days keep them');
select is((select summary ->> 'distance_m' from public.bdm_days where id = '21212121-8888-4000-a000-000000000001'), '1234',
  'the old day keeps its km');
select private.housekeeping();
select is((select count(*)::int from public.notifications where type = 'storage_alert' and recipient_id = '21212121-0000-4000-a000-00000000000a'), 1,
  'the storage alert reaches the admin once, however often it runs');

------------------------------------------------------------------------------
-- Backups
------------------------------------------------------------------------------
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('21212121-6666-4000-a000-000000000001', 'OPS-0001', 'Ops Patient', '+919000021001');
insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, sha256, status, owner_staff_id, patient_id, uploaded_at, created_at) values
  ('21212121-7777-4000-a000-000000000001', 'private', 'ops/rec1.m4a', 'call_recording', 'audio/mp4', 1000, null, 'uploaded',
   '21212121-0000-4000-a000-0000000000c1', null, now(), '2001-01-10'),
  ('21212121-7777-4000-a000-000000000002', 'private', 'ops/rec2.m4a', 'call_recording', 'audio/mp4', 2000, repeat('a', 64), 'uploaded',
   '21212121-0000-4000-a000-0000000000c1', null, now(), '2001-01-11'),
  ('21212121-7777-4000-a000-000000000003', 'private', 'ops/rx.pdf', 'prescription', 'application/pdf', 3000, null, 'uploaded',
   '21212121-0000-4000-a000-00000000000a', '21212121-6666-4000-a000-000000000001', now(), '2001-01-12');

select pg_temp.login('21212121-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.backup_plan(array['call_recording'], '2001-02-01') $$, 'P0001', 'not_allowed', 'only the admin backs up');
select pg_temp.login('21212121-0000-4000-a000-00000000000a');
select throws_ok($$ select public.backup_plan(array['thumbnail'], null) $$, 'P0001', 'invalid_input', 'unknown kinds are refused');
insert into ids select 'batch', (public.backup_plan(array['call_recording', 'prescription'], '2001-02-01')) ->> 'id';
select is(((public.backup_overview()) -> 'running' ->> 'total_items')::int, 3, 'the plan lists the three old files');
select is((public.backup_plan(array['voice_note'], null)) ->> 'id', (select v from ids where k = 'batch'),
  'starting again resumes the unfinished backup (no second batch)');
select is(((public.backup_plan(array['voice_note'], null)) ->> 'resumed')::boolean, true, 'and says so');
select is((select count(*)::int from public.backup_items where batch_id = (select v from ids where k = 'batch')::uuid), 3,
  'resuming adds no duplicate items');

insert into ids select 'page', (public.backup_items_page((select v from ids where k = 'batch')::uuid, null, 2))::text;
select is(jsonb_array_length((select v from ids where k = 'page')::jsonb -> 'items'), 2, 'pages of files to copy');
select isnt((select v from ids where k = 'page')::jsonb ->> 'next', null, 'with a cursor for the rest');
select is((select x ->> 'label' from jsonb_array_elements((public.backup_items_page((select v from ids where k = 'batch')::uuid, null, 100)) -> 'items') x
            where x ->> 'file_id' = '21212121-7777-4000-a000-000000000003'),
  'Ops Patient (OPS-0001)', 'a patient''s file is labelled with their name and UHID');

insert into ids select 'i1', id::text from public.backup_items where file_id = '21212121-7777-4000-a000-000000000001';
insert into ids select 'i2', id::text from public.backup_items where file_id = '21212121-7777-4000-a000-000000000002';
insert into ids select 'i3', id::text from public.backup_items where file_id = '21212121-7777-4000-a000-000000000003';
select is(public.backup_mark_verified((select v from ids where k = 'batch')::uuid, jsonb_build_array(
    jsonb_build_object('id', (select v from ids where k = 'i1'), 'sha256', repeat('b', 64), 'path', 'call_recording/2001-01/a.m4a'),
    jsonb_build_object('id', (select v from ids where k = 'i2'), 'sha256', repeat('c', 64), 'path', 'call_recording/2001-01/b.m4a'))),
  '{"verified": 1, "mismatched": 1, "remaining": 2}'::jsonb,
  'a copy whose SHA-256 differs from the stored one is not counted');
select is((select sha256 from public.files where id = '21212121-7777-4000-a000-000000000001'), repeat('b', 64),
  'a file with no stored checksum takes the verified one');

-- Purge: only heavy media, only with a verified backup; the whole call is refused otherwise.
select throws_ok($$ select * from public.files_purge(array['21212121-7777-4000-a000-000000000002']::uuid[]) $$, 'P0001', 'not_backed_up',
  'purge refuses a file without a verified backup');
select throws_ok($$ select * from public.files_purge(array['21212121-7777-4000-a000-000000000001', '21212121-7777-4000-a000-000000000002']::uuid[]) $$,
  'P0001', 'not_backed_up', 'one unverified file stops the whole purge');
select throws_ok($$ select * from public.files_purge(array['21212121-7777-4000-a000-000000000003']::uuid[]) $$, 'P0001', 'not_purgeable',
  'clinical records are never purged');
select throws_ok($$ select public.purge_preview(array['prescription'], '2001-02-01') $$, 'P0001', 'not_purgeable',
  'and cannot even be previewed for purging');
select is((select jsonb_build_object('ready', x -> 'ready_files', 'blocked', x -> 'blocked_files')
           from jsonb_array_elements(public.purge_preview(array['call_recording'], '2001-02-01')) x),
  '{"ready": 1, "blocked": 1}'::jsonb, 'the preview splits ready and not-yet-backed-up files');
select is(public.purge_candidates(array['call_recording'], '2001-02-01', 100), array['21212121-7777-4000-a000-000000000001']::uuid[],
  'candidates are only the verified files');
select is((select count(*)::int from public.files_purge(array['21212121-7777-4000-a000-000000000001']::uuid[])), 1, 'a verified file is purged');
select is((select status::text from public.files where id = '21212121-7777-4000-a000-000000000001'), 'deleted', 'and marked deleted');

-- Finish the batch, then re-check the folder: a changed copy loses its backed-up mark.
select is(public.backup_mark_verified((select v from ids where k = 'batch')::uuid, jsonb_build_array(
    jsonb_build_object('id', (select v from ids where k = 'i2'), 'sha256', repeat('a', 64), 'path', 'call_recording/2001-01/b.m4a'),
    jsonb_build_object('id', (select v from ids where k = 'i3'), 'sha256', repeat('d', 64), 'path', 'prescription/2001-01/c.pdf'))) ->> 'remaining',
  '0', 'every file copied');
select is((select status from public.backup_batches where id = (select v from ids where k = 'batch')::uuid), 'done', 'the batch is done');
select is(public.backup_recheck((select v from ids where k = 'batch')::uuid, jsonb_build_array(
    jsonb_build_object('id', (select v from ids where k = 'i2'), 'sha256', repeat('e', 64)),
    jsonb_build_object('id', (select v from ids where k = 'i3'), 'sha256', repeat('d', 64)))),
  '{"ok": 1, "bad": 1}'::jsonb, 'the re-check finds the corrupted copy');
select throws_ok($$ select * from public.files_purge(array['21212121-7777-4000-a000-000000000002']::uuid[]) $$, 'P0001', 'not_backed_up',
  'a file whose copy changed can no longer be purged');

------------------------------------------------------------------------------
-- Full export and the weekly reminder
------------------------------------------------------------------------------
select ok((public.export_tables()) @> '[{"table": "patients"}]', 'every public table is listed for the export');
select throws_ok($$ select public.export_table_page('pg_authid', null, 10) $$, 'P0001', 'invalid_input', 'only public tables');
select throws_ok($$ select public.export_table_page('patients; drop table x', null, 10) $$, 'P0001', 'invalid_input', 'no SQL through the name');
insert into ids select 'p1', (public.export_table_page('staff', null, 2))::text;
select is(jsonb_array_length((select v from ids where k = 'p1')::jsonb -> 'rows'), 2, 'a page of rows');
select isnt((public.export_table_page('staff', (select v from ids where k = 'p1')::jsonb ->> 'next', 2)) -> 'rows' -> 0,
  (select v from ids where k = 'p1')::jsonb -> 'rows' -> 0, 'the next page continues after the cursor');

reset role;
update public.backup_batches set finished_at = now() - interval '10 days' where kind = 'database';
select private.backup_reminder();
select private.backup_reminder();
select is((select count(*)::int from public.notifications where type = 'backup_reminder' and recipient_id = '21212121-0000-4000-a000-00000000000a'), 1,
  'a week without an export reminds the admin once');
select pg_temp.login('21212121-0000-4000-a000-00000000000a');
select ok((public.export_record('2026-10-26 10:00', '[{"table": "patients", "rows": 5, "bytes": 100, "sha256": null, "path": "database/x/patients.jsonl"}]')) ->> 'status' = 'done',
  'the finished export is recorded');
select ok((public.backup_overview()) ->> 'last_export_at' is not null, 'and shows as the last export');

------------------------------------------------------------------------------
-- Sales targets
------------------------------------------------------------------------------
reset role;
update public.app_settings set value = value || '{"targets_enabled": true}'::jsonb where section = 'sales';
select pg_temp.login('21212121-0000-4000-a000-0000000000c3');
select throws_ok($$ select public.set_sales_target('21212121-0000-4000-a000-0000000000c1', current_date, 'converted', 5) $$,
  'P0001', 'not_allowed', 'only the admin sets targets');
select pg_temp.login('21212121-0000-4000-a000-00000000000a');
select throws_ok($$ select public.set_sales_target('21212121-0000-4000-a000-0000000000d1', current_date, 'converted', 5) $$,
  'P0001', 'not_found', 'targets are for sales staff only');
select is((public.set_sales_target('21212121-0000-4000-a000-0000000000c1', (select d from today), 'converted', 5)) -> 'converted' ->> 'target', '5',
  'the admin sets a monthly target');
select pg_temp.login('21212121-0000-4000-a000-0000000000c1');
select is((public.dashboard_sales_exec()) -> 'target' -> 'converted', '{"target": 5, "actual": 0}'::jsonb, 'the salesperson sees it in My day');
select pg_temp.login('21212121-0000-4000-a000-0000000000c2');
select is((select count(*)::int from public.sales_targets where staff_id = '21212121-0000-4000-a000-0000000000c1'), 0,
  'colleagues don''t see each other''s targets');
select pg_temp.login('21212121-0000-4000-a000-0000000000c3');
select ok((public.sales_targets_month((select d from today))) -> 'people' @> '[{"name": "Ops Sales", "converted": {"target": 5}}]',
  'the manager sees everyone''s targets and progress');

------------------------------------------------------------------------------
-- Admin dashboard
------------------------------------------------------------------------------
select pg_temp.login('21212121-0000-4000-a000-0000000000c3');
select throws_ok($$ select public.dashboard_admin(current_date - 6, current_date) $$, 'P0001', 'not_allowed', 'the admin dashboard is admin only');
select pg_temp.login('21212121-0000-4000-a000-00000000000a');
insert into ids select 'dash', (public.dashboard_admin((select d from today) - 29, (select d from today)))::text;
select is((select count(*)::int from jsonb_object_keys((select v from ids where k = 'dash')::jsonb) k
           where k in ('kpis', 'previous', 'trend', 'outstanding', 'sessions', 'by_source', 'funnel', 'agreed_vs_billed',
                       'top_medicines', 'pharmacy_stock', 'bdm', 'storage', 'backup', 'integrations')), 14, 'every section in one call');
select is((select sum((x ->> 'revenue_paise')::bigint)::bigint from jsonb_array_elements((select v from ids where k = 'dash')::jsonb -> 'trend') x),
  ((select v from ids where k = 'dash')::jsonb -> 'kpis' ->> 'revenue_paise')::bigint, 'the trend adds up to the revenue tile');
select is(jsonb_array_length((select v from ids where k = 'dash')::jsonb -> 'trend'), 30, 'one point per day for a month');

------------------------------------------------------------------------------
-- Daily summary: once a day, after the set time
------------------------------------------------------------------------------
reset role;
update public.app_settings set value = value || '{"daily_summary_enabled": true, "daily_summary_time": "00:00", "extra_recipients": ["owner@example.com"]}'::jsonb
where section = 'notifications';
select private.daily_summary_tick();
select private.daily_summary_tick();
select is((select count(*)::int from public.job_runs where job = 'daily-summary'), 1, 'the summary goes once a day');
select is((select count(*)::int from public.notifications where type = 'daily_summary' and recipient_id = '21212121-0000-4000-a000-00000000000a'), 1,
  'and appears in the admin''s bell');
select ok((public.daily_summary_payload((select d from today))) -> 'recipients' @> '[{"email": "ops-admin@example.com"}, {"email": "owner@example.com"}]',
  'emailed to the admins and the extra addresses');

select * from finish();
rollback;
