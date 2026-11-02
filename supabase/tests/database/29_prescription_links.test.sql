-- Prescriptions saved on the visit / treatment session / IP stay (create_document links),
-- shown on the session (treatment card) and in the Documents list with what they are for.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

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

insert into auth.users (id, email) values ('29292929-0000-4000-a000-0000000000b1', 'rx-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values ('29292929-0000-4000-a000-0000000000b1', 'receptionist', 'RX Rec', 'rxrec');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('29292929-1111-4000-a000-000000000001', 'RXTEST-1', 'Rx Patient', '+919811429001'),
  ('29292929-1111-4000-a000-000000000002', 'RXTEST-2', 'Rx Other', '+919811429002');
insert into public.doctors (id, full_name) values
  ('29292929-2222-4000-a000-000000000001', 'Dr Rx Visit'),
  ('29292929-2222-4000-a000-000000000002', 'Dr Rx Laser');

-- A visit (arrived booking) and a laser treatment whose session 2 is that booking; session 1 was marked done without one.
insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, status) values
  ('29292929-3333-4000-a000-000000000001', '29292929-1111-4000-a000-000000000001', '29292929-2222-4000-a000-000000000001',
   '2026-11-02', '2026-11-02 05:00+00', '2026-11-02 05:15+00', 'done'),
  ('29292929-3333-4000-a000-000000000002', '29292929-1111-4000-a000-000000000001', '29292929-2222-4000-a000-000000000002',
   '2026-11-20', '2026-11-20 06:00+00', '2026-11-20 06:15+00', 'arrived');
insert into public.visits (id, patient_id, appointment_id, doctor_id, visit_date) values
  ('29292929-4444-4000-a000-000000000001', '29292929-1111-4000-a000-000000000001', '29292929-3333-4000-a000-000000000001',
   '29292929-2222-4000-a000-000000000001', '2026-11-02'),
  ('29292929-4444-4000-a000-000000000002', '29292929-1111-4000-a000-000000000001', '29292929-3333-4000-a000-000000000002',
   '29292929-2222-4000-a000-000000000002', '2026-11-20');
insert into public.patient_treatments (id, patient_id, name, start_date, planned_sessions, doctor_id) values
  ('29292929-5555-4000-a000-000000000001', '29292929-1111-4000-a000-000000000001', 'Laser RX', '2026-11-01', 2,
   '29292929-2222-4000-a000-000000000002');
insert into public.treatment_sessions (id, treatment_id, patient_id, seq, planned_date, actual_date, status, appointment_id) values
  ('29292929-6666-4000-a000-000000000001', '29292929-5555-4000-a000-000000000001', '29292929-1111-4000-a000-000000000001',
   1, '2026-11-01', '2026-11-01', 'done', null),
  ('29292929-6666-4000-a000-000000000002', '29292929-5555-4000-a000-000000000001', '29292929-1111-4000-a000-000000000001',
   2, '2026-11-20', null, 'booked', '29292929-3333-4000-a000-000000000002');
insert into public.admissions (id, patient_id, ip_number, admitted_at) values
  ('29292929-7777-4000-a000-000000000001', '29292929-1111-4000-a000-000000000001', 'IP-RX-1', '2026-11-03 04:00+00');

insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, status, owner_staff_id)
select ('29292929-8888-4000-a000-00000000000' || n)::uuid, 'private', 'document/2026/11/rx-' || n || '.pdf', 'document',
       'application/pdf', 1000, 'uploaded', '29292929-0000-4000-a000-0000000000b1'
from generate_series(1, 7) n;

create function pg_temp.doc(p_n int, p_links jsonb, p_patient text default '29292929-1111-4000-a000-000000000001')
returns uuid language sql as $$
  select public.create_document(jsonb_build_object('patient_id', p_patient, 'title', 'Prescription',
           'file_id', '29292929-8888-4000-a000-00000000000' || p_n) || p_links,
         ('29292929-9999-4000-a000-00000000000' || p_n)::uuid)
$$;
grant execute on function pg_temp.doc(int, jsonb, text) to authenticated;

select pg_temp.login('29292929-0000-4000-a000-0000000000b1');

------------------------------------------------------------------------------
-- Saved from a visit (booking Actions → Add prescription)
------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.doc(1, '{"appointment_id": "29292929-3333-4000-a000-000000000001"}') $$, 'a prescription is saved from a visit');
select results_eq($$ select visit_id, session_id, doctor_id, doc_date from public.documents where id = '29292929-9999-4000-a000-000000000001' $$,
  $$ values ('29292929-4444-4000-a000-000000000001'::uuid, null::uuid, '29292929-2222-4000-a000-000000000001'::uuid, '2026-11-02'::date) $$,
  'it is linked to the visit, with the visit''s doctor and day');

select lives_ok($$ select pg_temp.doc(2, '{"appointment_id": "29292929-3333-4000-a000-000000000002"}') $$, 'saved from a session''s booking');
select results_eq($$ select visit_id, session_id, doctor_id from public.documents where id = '29292929-9999-4000-a000-000000000002' $$,
  $$ values ('29292929-4444-4000-a000-000000000002'::uuid, '29292929-6666-4000-a000-000000000002'::uuid, '29292929-2222-4000-a000-000000000002'::uuid) $$,
  'the booking''s treatment session is linked too');

------------------------------------------------------------------------------
-- Saved from a treatment session (Treatments tab → Prescription)
------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.doc(3, '{"session_id": "29292929-6666-4000-a000-000000000001"}') $$, 'saved from a session marked done without a booking');
select results_eq($$ select visit_id, session_id, doctor_id, doc_date from public.documents where id = '29292929-9999-4000-a000-000000000003' $$,
  $$ values (null::uuid, '29292929-6666-4000-a000-000000000001'::uuid, '29292929-2222-4000-a000-000000000002'::uuid, '2026-11-01'::date) $$,
  'linked to the session, with the treatment''s doctor and the day it was done');
select lives_ok($$ select pg_temp.doc(4, '{"session_id": "29292929-6666-4000-a000-000000000002"}') $$, 'saved from a booked session');
select is((select visit_id from public.documents where id = '29292929-9999-4000-a000-000000000004'), '29292929-4444-4000-a000-000000000002'::uuid,
  'a session''s booking visit is filled in');

select lives_ok($$ select pg_temp.doc(5, '{"admission_id": "29292929-7777-4000-a000-000000000001"}') $$, 'saved from an IP stay');

------------------------------------------------------------------------------
-- Another patient's visit, session or stay is refused
------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.doc(6, '{"appointment_id": "29292929-3333-4000-a000-000000000001"}', '29292929-1111-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'another patient''s visit is refused');
select throws_ok($$ select pg_temp.doc(6, '{"session_id": "29292929-6666-4000-a000-000000000001"}', '29292929-1111-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'another patient''s session is refused');
select throws_ok($$ select pg_temp.doc(6, '{"admission_id": "29292929-7777-4000-a000-000000000001"}', '29292929-1111-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'another patient''s IP stay is refused');
select lives_ok($$ select pg_temp.doc(7, '{}') $$, 'a document with no link still saves as before');

------------------------------------------------------------------------------
-- Shown on the session and in the Documents list
------------------------------------------------------------------------------
select is(jsonb_array_length((public.patient_treatments_list('29292929-1111-4000-a000-000000000001') -> 0 -> 'sessions' -> 0 -> 'documents')), 1,
  'session 1 lists its prescription');
create temp table docs as
  select e.value as d from jsonb_array_elements(public.patient_documents('29292929-1111-4000-a000-000000000001') -> 'items') e;
select results_eq($$ select d ->> 'treatment', (d ->> 'session_seq')::int, d ->> 'doctor' from docs where d ->> 'id' = '29292929-9999-4000-a000-000000000003' $$,
  $$ values ('Laser RX', 1, 'Dr Rx Laser') $$, 'the Documents list says which session it is for');
select results_eq($$ select d ->> 'visit_date', d ->> 'ip_number' from docs where d ->> 'id' in ('29292929-9999-4000-a000-000000000001', '29292929-9999-4000-a000-000000000005') order by d ->> 'id' $$,
  $$ values ('2026-11-02', null), (null, 'IP-RX-1') $$, 'and which visit or IP stay');

select * from finish();
rollback;
