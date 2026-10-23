-- Phase 2: registration decisions, UHIDs, self-registration links, search, merge, import.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(44);

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
  ('55555555-0000-4000-a000-00000000000a', 'p2-admin@staff.invalid'),
  ('55555555-0000-4000-a000-0000000000b1', 'p2-rec@staff.invalid'),
  ('55555555-0000-4000-a000-0000000000c1', 'p2-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('55555555-0000-4000-a000-00000000000a', 'admin', 'P2 Admin', 'p2admin'),
  ('55555555-0000-4000-a000-0000000000b1', 'receptionist', 'P2 Rec', 'p2rec'),
  ('55555555-0000-4000-a000-0000000000c1', 'sales_executive', 'P2 Sales', 'p2sales');
-- A known UHID series so the numbers below are exact.
delete from public.number_series where series_key = 'uhid';
insert into public.number_series (series_key, fy, prefix, format, next_value) values ('uhid', 'ALL', 'T', '{prefix}{n}', 5001);

------------------------------------------------------------------------------
-- New registrations and UHIDs
------------------------------------------------------------------------------
select pg_temp.login('55555555-0000-4000-a000-0000000000b1');
select is(
  public.register_patient('{"full_name":"  Meera   Nair ","phone_e164":"+919845012345","gender":"female","age_years":34,
    "allergies":["Penicillin"," penicillin ",""],"consents":{"treatment":{"given":true,"method":"paper"}}}',
    'new', p_client_id => '55555555-1111-4000-a000-000000000001') ->> 'uhid',
  'T5001', 'first patient gets the next UHID');
select is(
  (select full_name from public.patients where id = '55555555-1111-4000-a000-000000000001'),
  'Meera Nair', 'names are trimmed and inner spaces collapsed');
select ok(
  (select dob_estimated and extract(month from dob) = 7 from public.patients where id = '55555555-1111-4000-a000-000000000001'),
  'age only → estimated birth date');
select ok(
  (select consents -> 'treatment' ? 'at' and consents -> 'treatment' ->> 'by' = '55555555-0000-4000-a000-0000000000b1'
     from public.patients where id = '55555555-1111-4000-a000-000000000001'),
  'consent records when and by whom');
select is(
  public.register_patient('{"full_name":"Meera Nair"}', 'new', p_client_id => '55555555-1111-4000-a000-000000000001') ->> 'repeat',
  'true', 'retrying with the same client id does not create a second patient');
select is((select count(*)::int from public.patients where full_name = 'Meera Nair'), 1, 'still one Meera');

select throws_ok($$ select public.register_patient('{"full_name":"Bad Phone","phone_e164":"98450"}', 'new') $$,
  'P0001', 'invalid_input', 'a bad phone number is refused');
select is(
  public.register_patient('{"full_name":"Ravi Kumar","phone_e164":"+919845099999"}', 'new',
    p_client_id => '55555555-1111-4000-a000-000000000002') ->> 'uhid',
  'T5002', 'a failed registration did not use up a UHID (no gaps)');

------------------------------------------------------------------------------
-- Duplicate matrix: the same phone comes again
------------------------------------------------------------------------------
select is(
  (select jsonb_array_length(public.find_patient_matches('+919845012345', 'Someone Else'))),
  1, 'same phone → one possible match');
select is(
  (select public.find_patient_matches('+919845012345', 'Someone Else') -> 0 -> 'reasons'),
  '["phone"]'::jsonb, 'the match says why (phone)');
select is(
  (select jsonb_array_length(public.find_patient_matches('+919800000000', 'Meera Nayar',
     (select dob from public.patients where id = '55555555-1111-4000-a000-000000000001')))),
  1, 'similar name with the same birth date also matches');
select is(
  (select jsonb_array_length(public.find_patient_matches('+919800000000', 'Completely Different'))),
  0, 'no match → empty');
select throws_ok($$ select public.register_patient('{"full_name":"Meera N"}', 'maybe') $$,
  'P0001', 'invalid_input', 'a decision is required');
select throws_ok($$ select public.register_patient('{"full_name":"Meera N","city":"Mysuru"}', 'update',
  '55555555-1111-4000-a000-000000000001') $$,
  'P0001', 'invalid_input', '"update" must name the fields to change');
select lives_ok($$ select public.register_patient('{"full_name":"Meera N","city":"Mysuru","email":"meera@example.com"}',
  'update', '55555555-1111-4000-a000-000000000001', array['city']) $$,
  'update with chosen fields');
select is(
  (select full_name || '|' || city || '|' || coalesce(email, '-') from public.patients where id = '55555555-1111-4000-a000-000000000001'),
  'Meera Nair|Mysuru|-', 'only the ticked field changed: name and email were NOT overwritten');
select is(
  (public.register_patient('{"full_name":"Anu Nair","phone_e164":"+919845012345"}', 'family',
     '55555555-1111-4000-a000-000000000001', p_client_id => '55555555-1111-4000-a000-000000000003')) ->> 'uhid',
  'T5003', 'family member gets her own UHID');
select is(
  (select family_group_id from public.patients where id = '55555555-1111-4000-a000-000000000003'),
  '55555555-1111-4000-a000-000000000001'::uuid, 'and is linked to the same family');
select is(
  (select jsonb_array_length(public.patient_header('55555555-1111-4000-a000-000000000001') -> 'family')), 1,
  'the patient file shows the family member');

------------------------------------------------------------------------------
-- Editing with optimistic locking
------------------------------------------------------------------------------
select is(
  (public.update_patient('55555555-1111-4000-a000-000000000002', '{"blood_group":"O+"}',
     (select version from public.patients where id = '55555555-1111-4000-a000-000000000002'))) ->> 'full_name',
  'Ravi Kumar', 'edit saves');
select throws_ok($$ select public.update_patient('55555555-1111-4000-a000-000000000002', '{"city":"X"}', 1) $$,
  'P0001', 'stale_version', 'an edit based on an old copy is refused');

------------------------------------------------------------------------------
-- Search
------------------------------------------------------------------------------
select is((select public.global_search('T5002') -> 0 ->> 'title'), 'Ravi Kumar', 'search by UHID');
select is((select public.global_search('98450 99999') -> 0 ->> 'title'), 'Ravi Kumar', 'search by phone with spaces');
select is((select public.global_search('9999') -> 0 ->> 'title'), 'Ravi Kumar', 'search by the last digits');
select is((select public.global_search('ravi') -> 0 ->> 'title'), 'Ravi Kumar', 'search by part of the name');
select is((select public.global_search('r')), '[]'::jsonb, 'one letter is too short to search');

------------------------------------------------------------------------------
-- Who can see patients
------------------------------------------------------------------------------
select pg_temp.login('55555555-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.patients), 0, 'sales cannot read patients directly');
select throws_ok($$ select public.register_patient('{"full_name":"X"}', 'new') $$,
  'P0001', 'not_allowed', 'sales cannot register patients');
select is(public.global_search('Ravi'), '[]'::jsonb, 'sales get no patient search results here');

------------------------------------------------------------------------------
-- QR self-registration
------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.public_form_submit(text, jsonb, text)', 'execute'),
  'staff logins cannot call the public form functions directly');
select ok(not has_function_privilege('anon', 'public.public_form_info(text)', 'execute'),
  'nor can visitors (only the Edge Function, after the bot check)');
select pg_temp.login('55555555-0000-4000-a000-0000000000b1');
create temp table link on commit drop as select public.create_public_link('self_registration') as l;
grant select on link to authenticated;
select pg_temp.login(null);
select ok((select (public.public_form_info(l ->> 'token') ->> 'valid')::boolean from link), 'a fresh QR link works');
select is((select public.public_form_info('not-a-real-token') ->> 'valid') , 'false', 'a made-up token does not');
select lives_ok($$ select public.public_form_submit((select l ->> 'token' from link),
  '{"full_name":"Self Reg","phone_e164":"+919811122233"}', 'iphash1') $$, 'the patient submits the form');
select is((select count(*)::int from public.registration_requests where full_name = 'Self Reg' and status = 'pending'), 1,
  'it waits for reception as a pending registration');
select ok((select count(*) > 0 from public.notifications where type = 'registration_pending'), 'reception is notified');
update public.public_links set expires_at = now() - interval '1 minute';
select throws_ok($$ select public.public_form_submit((select l ->> 'token' from link), '{"full_name":"Late"}', 'iphash2') $$,
  'P0001', 'link_expired', 'an expired QR link is refused');
update public.public_links set expires_at = now() + interval '1 hour';
select throws_ok($$
  select public.public_form_submit((select l ->> 'token' from link), '{"full_name":"Spam"}', 'iphash3')
  from generate_series(1, 6) $$,
  'P0001', 'rate_limited', 'more than 5 forms in 10 minutes from one network are refused');

------------------------------------------------------------------------------
-- Merge (admin) moves every linked row
------------------------------------------------------------------------------
insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, status, owner_staff_id, patient_id)
values ('55555555-2222-4000-a000-000000000001', 'private', 'document/2026/10/p2.pdf', 'document', 'application/pdf', 10,
        'uploaded', '55555555-0000-4000-a000-0000000000b1', '55555555-1111-4000-a000-000000000002');
insert into public.documents (patient_id, title, file_id)
values ('55555555-1111-4000-a000-000000000002', 'Old report', '55555555-2222-4000-a000-000000000001');
select pg_temp.login('55555555-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.merge_patients('55555555-1111-4000-a000-000000000002',
  '55555555-1111-4000-a000-000000000001', 'duplicate') $$, 'P0001', 'not_allowed', 'only admins merge');
select pg_temp.login('55555555-0000-4000-a000-00000000000a');
select is(
  public.merge_patients('55555555-1111-4000-a000-000000000002', '55555555-1111-4000-a000-000000000001', 'same person')
    -> 'moved' ->> 'public.documents.patient_id',
  '1', 'merge moves the documents');
select is((select count(*)::int from public.files where patient_id = '55555555-1111-4000-a000-000000000002'), 0,
  'and the files');
select is((select merged_into_id from public.patients where id = '55555555-1111-4000-a000-000000000002'),
  '55555555-1111-4000-a000-000000000001'::uuid, 'the duplicate points at the kept patient');

------------------------------------------------------------------------------
-- DocPulse import
------------------------------------------------------------------------------
select is(
  public.import_patients('[{"full_name":"Imp One","phone_e164":"+919800011111","uhid":"OLD-1"},
                           {"full_name":"","phone_e164":"+919800011112"},
                           {"full_name":"Imp Three","uhid":"T5001"}]', true) - 'errors',
  '{"ok":1,"dry_run":true}'::jsonb, 'dry run: one good row, two problems found');
select is(
  (select count(*)::int from public.patients where full_name = 'Imp One'), 0, 'a dry run saves nothing');

select * from finish();
rollback;
