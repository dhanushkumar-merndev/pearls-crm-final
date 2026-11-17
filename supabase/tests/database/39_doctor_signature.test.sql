-- The doctor's signature prints on discharge summaries (Phase 19d): discharge_signature_file gives the
-- signing doctor's uploaded signature; reception may view signature files (and still not others'
-- private files); sales staff can't.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

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
  ('39393939-0000-4000-a000-0000000000a1', 'sig-admin@staff.invalid'),
  ('39393939-0000-4000-a000-0000000000b1', 'sig-rec@staff.invalid'),
  ('39393939-0000-4000-a000-0000000000c1', 'sig-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('39393939-0000-4000-a000-0000000000a1', 'admin', 'Sig Admin', 'sigadmin'),
  ('39393939-0000-4000-a000-0000000000b1', 'receptionist', 'Sig Rec', 'sigrec'),
  ('39393939-0000-4000-a000-0000000000c1', 'sales_executive', 'Sig Sales', 'sigsales');
insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, status, owner_staff_id) values
  ('39393939-7777-4000-a000-000000000001', 'private', 'doctor_signature/test/s1.png', 'doctor_signature', 'image/png', 9000,
   'uploaded', '39393939-0000-4000-a000-0000000000a1'),
  ('39393939-7777-4000-a000-000000000002', 'private', 'voice_note/test/v1.m4a', 'voice_note', 'audio/mp4', 9000,
   'uploaded', '39393939-0000-4000-a000-0000000000a1');
insert into public.doctors (id, full_name, signature_file_id) values
  ('39393939-2222-4000-a000-000000000001', 'Dr Sign', '39393939-7777-4000-a000-000000000001'),
  ('39393939-2222-4000-a000-000000000002', 'Dr NoSign', null);
insert into public.patients (id, uhid, full_name, gender, phone_e164) values
  ('39393939-1111-4000-a000-000000000001', 'SIG-1', 'Sig Patient', 'male', '+919811439001');
insert into public.visits (id, patient_id, doctor_id, visit_date) values
  ('39393939-5555-4000-a000-000000000001', '39393939-1111-4000-a000-000000000001', '39393939-2222-4000-a000-000000000001', '2026-11-05'),
  ('39393939-5555-4000-a000-000000000002', '39393939-1111-4000-a000-000000000001', '39393939-2222-4000-a000-000000000002', '2026-11-06'),
  ('39393939-5555-4000-a000-000000000003', '39393939-1111-4000-a000-000000000001', '39393939-2222-4000-a000-000000000002', '2026-11-07');
insert into public.discharge_summaries (id, patient_id, visit_id, content) values
  ('39393939-6666-4000-a000-000000000001', '39393939-1111-4000-a000-000000000001', '39393939-5555-4000-a000-000000000001',
   '{"sections": [], "medications": []}'),
  ('39393939-6666-4000-a000-000000000002', '39393939-1111-4000-a000-000000000001', '39393939-5555-4000-a000-000000000002',
   '{"sections": [], "medications": [], "doctor_id": "39393939-2222-4000-a000-000000000001"}'),
  ('39393939-6666-4000-a000-000000000003', '39393939-1111-4000-a000-000000000001', '39393939-5555-4000-a000-000000000003',
   '{"sections": [], "medications": []}');

select pg_temp.login('39393939-0000-4000-a000-0000000000b1');
select is(public.discharge_signature_file('39393939-6666-4000-a000-000000000001'), '39393939-7777-4000-a000-000000000001'::uuid,
  'OP: the visit''s doctor signs');
select is(public.discharge_signature_file('39393939-6666-4000-a000-000000000002'), '39393939-7777-4000-a000-000000000001'::uuid,
  'the chosen "Signed by" doctor wins over the visit''s doctor');
select is(public.discharge_signature_file('39393939-6666-4000-a000-000000000003'), null,
  'a doctor without a signature: none (the print keeps the blank line)');
select is((select count(*)::int from public.files where id = '39393939-7777-4000-a000-000000000001'), 1,
  'reception can view a doctor''s signature (to print it)');
select is((select count(*)::int from public.files where id = '39393939-7777-4000-a000-000000000002'), 0,
  'but not other staff files');

select pg_temp.login('39393939-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.discharge_signature_file('39393939-6666-4000-a000-000000000001') $$,
  'P0001', 'not_allowed', 'sales staff can''t');
select is((select count(*)::int from public.files where id = '39393939-7777-4000-a000-000000000001'), 0,
  'sales staff can''t view signatures');

select * from finish();
rollback;
