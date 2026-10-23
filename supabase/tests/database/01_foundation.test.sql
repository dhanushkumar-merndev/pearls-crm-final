-- Phase 0 foundation rules. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(55);

------------------------------------------------------------------------------
-- Fixtures (fake). All changes roll back at the end.
------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-0000-4000-a000-00000000000a', 't-admin@test.local'),
  ('11111111-0000-4000-a000-0000000000b1', 't-rec1@test.local'),
  ('11111111-0000-4000-a000-0000000000b2', 't-rec2@test.local'),
  ('11111111-0000-4000-a000-0000000000c1', 't-sales@test.local'),
  ('11111111-0000-4000-a000-0000000000d1', 't-bdm@test.local');
insert into public.staff (id, role, full_name) values
  ('11111111-0000-4000-a000-00000000000a', 'admin', 'T Admin'),
  ('11111111-0000-4000-a000-0000000000b1', 'receptionist', 'T Rec One'),
  ('11111111-0000-4000-a000-0000000000b2', 'receptionist', 'T Rec Two'),
  ('11111111-0000-4000-a000-0000000000c1', 'sales_executive', 'T Sales'),
  ('11111111-0000-4000-a000-0000000000d1', 'bdm', 'T Bdm');
-- The seed adds a clinic locally; online (pnpm db:test:remote) there may be none yet.
insert into public.clinic_settings (branch_code, name, gstin)
values ('main', 'T Clinic', '29ABCDE1234F1Z5')
on conflict (branch_code) do nothing;

-- The number-series tests below start from known values; real series (online)
-- are removed inside this transaction only — everything rolls back at the end.
delete from public.number_series;

------------------------------------------------------------------------------
-- Login-token hook
------------------------------------------------------------------------------
select is(
  public.custom_access_token_hook(jsonb_build_object(
    'user_id', '11111111-0000-4000-a000-00000000000a', 'claims', '{}'::jsonb)) -> 'claims' ->> 'app_role',
  'admin', 'token hook adds app_role');
select is(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', gen_random_uuid(), 'claims', '{}'::jsonb)) -> 'claims' -> 'staff_active')::boolean,
  false, 'token hook marks unknown users inactive');

------------------------------------------------------------------------------
-- Role helpers and me()
------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-0000000000b1","role":"authenticated"}';
select is(private.my_role(), 'receptionist'::staff_role, 'my_role reads the live staff table');
select is(public.me() ->> 'role', 'receptionist', 'me() returns the role');
select ok((select count(*) from public.staff_directory()) >= 5, 'staff_directory lists colleagues');
select is((select count(*) from public.staff)::int, 1, 'receptionist sees only their own staff row');
select throws_ok(
  $$ select public.admin_update_staff('11111111-0000-4000-a000-0000000000b2', '{"role":"admin"}') $$,
  'P0001', 'not_allowed', 'non-admins cannot change staff');
select throws_ok(
  $$ insert into public.staff (id, role, full_name) values (gen_random_uuid(), 'admin', 'x') $$,
  '42501', null, 'no direct writes to staff');

-- Admin
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-00000000000a","role":"authenticated"}';
select ok((select count(*) from public.staff) >= 5, 'admin sees all staff');
select throws_ok(
  $$ select public.admin_update_staff('11111111-0000-4000-a000-00000000000a', '{"active":false}') $$,
  'P0001', 'not_allowed', 'admin cannot deactivate themselves');
select lives_ok(
  $$ select public.admin_update_staff('11111111-0000-4000-a000-0000000000b2', '{"active":false}', 'left the clinic') $$,
  'admin deactivates a receptionist');

reset role;
select ok(
  (select deactivated_at is not null from public.staff where id = '11111111-0000-4000-a000-0000000000b2'),
  'deactivation records the time');
select is(
  (select reason from public.audit_log
    where table_name = 'staff' and row_id = '11111111-0000-4000-a000-0000000000b2'
    order by id desc limit 1),
  'left the clinic', 'audit log keeps the reason');
select is(
  (select actor_id from public.audit_log
    where table_name = 'staff' and row_id = '11111111-0000-4000-a000-0000000000b2'
    order by id desc limit 1),
  '11111111-0000-4000-a000-00000000000a'::uuid, 'audit log keeps who did it');
select ok(
  (select changes ? 'active' and not changes ? 'updated_at' from public.audit_log
    where table_name = 'staff' and row_id = '11111111-0000-4000-a000-0000000000b2'
    order by id desc limit 1),
  'audit log stores only the changed fields');

-- The deactivated receptionist is blocked on the very next request.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-0000000000b2","role":"authenticated"}';
select ok(private.my_role() is null, 'deactivated staff have no role');
select throws_ok($$ select public.me() $$, 'P0001', 'staff_inactive', 'deactivated staff are refused');
select is((select count(*) from public.clinic_settings)::int, 0, 'deactivated staff read nothing');

------------------------------------------------------------------------------
-- Number series
------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-00000000000a","role":"authenticated"}';
select is(
  public.set_number_series('procedure_receipt', '2026-27', 'T', '{prefix}/{fy}/{n}', 964) ->> 'next_preview',
  'T/26-27/964', 'admin sets a series and sees the next number');
select lives_ok(
  $$ select public.set_number_series('uhid', 'ALL', 'T', '{prefix}{n}', 1001) $$, 'UHID series set');
select is(public.preview_next_number('uhid'), 'T1001', 'preview shows the next UHID');
select lives_ok(
  $$ select public.set_number_series('pharmacy_invoice', '2026-27', 'P', '{prefix}/{fy}/{n}', 7, 4) $$,
  'padded series set');
reset role;

select is(private.take_number('procedure_receipt', '2026-10-01 05:26:00+00'), 'T/26-27/964', 'takes 964');
select is(private.take_number('procedure_receipt', '2026-10-01 06:00:00+00'), 'T/26-27/965', 'then 965');
select is(private.take_number('procedure_receipt', '2027-03-31 18:29:59+00'), 'T/26-27/966',
  '31/03/2027 23:59:59 IST is still FY 26-27');
select is(private.take_number('procedure_receipt', '2027-03-31 18:30:00+00'), 'T/27-28/1',
  '01/04/2027 00:00 IST starts FY 27-28 at 1');
select is(private.take_number('uhid', '2027-06-01 00:00:00+00'), 'T1001',
  'preview did not use up the number, and UHIDs never reset');
select is(private.take_number('pharmacy_invoice', '2026-10-01 05:26:00+00'), 'P/26-27/0007', 'padding');

savepoint before_take;
select is(private.take_number('procedure_receipt', '2026-10-02 05:00:00+00'), 'T/26-27/967', 'takes 967');
rollback to savepoint before_take;
select is(private.take_number('procedure_receipt', '2026-10-02 05:00:00+00'), 'T/26-27/967',
  'a rolled-back finalize gives the number back (no gaps)');

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-00000000000a","role":"authenticated"}';
select throws_ok(
  $$ select public.set_number_series('procedure_receipt', '2026-27', 'T', '{prefix}/{fy}/{n}', 960) $$,
  'P0001', 'series_below_used', 'cannot move a series back to used numbers');

------------------------------------------------------------------------------
-- Settings
------------------------------------------------------------------------------
select is(public.update_settings('registration_form', '{"slot_minutes":15}', 0), 1, 'first save is version 1');
select is(public.update_settings('registration_form', '{"slot_minutes":20}', 1), 2, 'next save is version 2');
select throws_ok($$ select public.update_settings('registration_form', '{"slot_minutes":30}', 1) $$,
  'P0001', 'stale_version', 'stale version is refused');
select throws_ok($$ select public.update_settings('nonsense', '{}', 0) $$,
  'P0001', 'unknown_settings_section', 'unknown section is refused');
select lives_ok($$ select public.update_settings('whatsapp', '{"enabled":false}', 0) $$, 'admin-only section saved');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-0000000000b1","role":"authenticated"}';
select is((select count(*) from public.app_settings where section = 'registration_form')::int, 1,
  'receptionist reads public settings');
select is((select count(*) from public.app_settings where section = 'whatsapp')::int, 0,
  'receptionist cannot read admin-only settings');
select throws_ok($$ select public.update_settings('registration_form', '{}', 2) $$,
  'P0001', 'not_allowed', 'receptionist cannot change settings');
update public.clinic_settings set name = 'Hacked' where branch_code = 'main';
reset role;
select isnt((select name from public.clinic_settings where branch_code = 'main'), 'Hacked',
  'receptionist cannot edit the clinic profile');

------------------------------------------------------------------------------
-- Files
------------------------------------------------------------------------------
create temp table usage_before as
  select coalesce((select value from public.usage_counters
                    where metric = 'tigris_writes'
                      and month = date_trunc('month', private.ist(now()))::date), 0) as v;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-0000000000b1","role":"authenticated"}';
select matches(
  public.files_begin_upload('prescription', 'image/webp', 500000, null, '{}', '22222222-0000-4000-a000-000000000001') ->> 'object_key',
  '^prescription/[0-9]{4}/[0-9]{2}/22222222-0000-4000-a000-000000000001\.webp$',
  'upload key has no personal data');
select is(
  public.files_begin_upload('prescription', 'image/webp', 500000, null, '{}', '22222222-0000-4000-a000-000000000001') ->> 'status',
  'pending', 'retrying with the same id returns the same pending upload');
select throws_ok($$ select public.files_begin_upload('call_recording', 'audio/ogg', 1000) $$,
  'P0001', 'not_allowed', 'reception cannot upload call recordings');
select throws_ok($$ select public.files_begin_upload('prescription', 'image/webp', 9000000) $$,
  'P0001', 'file_too_large', 'size cap enforced');
select throws_ok($$ select public.files_begin_upload('prescription', 'image/gif', 1000) $$,
  'P0001', 'file_type_not_allowed', 'file type enforced');
select lives_ok($$ select public.files_mark_uploaded('22222222-0000-4000-a000-000000000001', 480000) $$,
  'owner confirms upload');
select lives_ok($$ select public.files_mark_uploaded('22222222-0000-4000-a000-000000000001', 480000) $$,
  'confirming twice is harmless');

reset role;
select is(
  (select value from public.usage_counters
    where metric = 'tigris_writes' and month = date_trunc('month', private.ist(now()))::date)
    - (select v from usage_before),
  1::bigint, 'an upload is counted once');

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-0000000000d1","role":"authenticated"}';
select is((select count(*) from public.files where id = '22222222-0000-4000-a000-000000000001')::int, 0,
  'other staff cannot see the file');

------------------------------------------------------------------------------
-- Notifications and client errors
------------------------------------------------------------------------------
reset role;
insert into public.notifications (recipient_id, type, title) values
  ('11111111-0000-4000-a000-0000000000b1', 'test', 'for rec1'),
  ('11111111-0000-4000-a000-00000000000a', 'test', 'for admin');
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-a000-0000000000b1","role":"authenticated"}';
select is((select count(*) from public.notifications)::int, 1, 'staff see only their own notifications');
select is(public.mark_notifications_read(), 1, 'mark all read');

select lives_ok($$
  select public.report_client_error('web', 'boom ' || g) from generate_series(1, 30) g
$$, '30 error reports are accepted');
select throws_ok($$ select public.report_client_error('web', 'one too many') $$,
  'P0001', 'rate_limited', 'error reports are rate-limited');

------------------------------------------------------------------------------
-- Logged-out visitors get the clinic name/logo and nothing else
------------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select ok(public.public_branding() ? 'name' and not public.public_branding() ? 'gstin',
  'login page gets only the clinic name and logo');
select throws_ok($$ select count(*) from public.clinic_settings $$, '42501', null,
  'logged-out visitors cannot read clinic settings');

select * from finish();
rollback;
