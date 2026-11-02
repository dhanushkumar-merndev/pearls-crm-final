-- Every bill says what it is for (booking / visit / treatment session / treatment), payments for a treatment
-- or IP stay must be the patient's, and the treatment card shows each session's bills and the money.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(23);

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
  ('31313131-0000-4000-a000-0000000000b1', 'care-rec@staff.invalid'),
  ('31313131-0000-4000-a000-0000000000c1', 'care-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('31313131-0000-4000-a000-0000000000b1', 'receptionist', 'Care Rec', 'carerec'),
  ('31313131-0000-4000-a000-0000000000c1', 'sales_executive', 'Care Sales', 'caresales');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('31313131-1111-4000-a000-000000000001', 'CARE-1', 'Care Patient', '+919811431001'),
  ('31313131-1111-4000-a000-000000000002', 'CARE-2', 'Care Other', '+919811431002');
insert into public.doctors (id, full_name) values
  ('31313131-2222-4000-a000-000000000001', 'Dr Care Visit'),
  ('31313131-2222-4000-a000-000000000002', 'Dr Care Laser');
update public.app_settings set value = value || '{"round_to_rupee": false}' where section = 'billing';

-- A plain consultation (visit, no treatment) and a laser package: session 1 done without a booking,
-- session 2 is a booking that has arrived. Plus an IP stay.
insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, status) values
  ('31313131-3333-4000-a000-000000000001', '31313131-1111-4000-a000-000000000001', '31313131-2222-4000-a000-000000000001',
   '2026-11-02', '2026-11-02 05:00+00', '2026-11-02 05:15+00', 'done'),
  ('31313131-3333-4000-a000-000000000002', '31313131-1111-4000-a000-000000000001', '31313131-2222-4000-a000-000000000002',
   '2026-11-20', '2026-11-20 06:00+00', '2026-11-20 06:15+00', 'arrived');
insert into public.visits (id, patient_id, appointment_id, doctor_id, visit_date) values
  ('31313131-4444-4000-a000-000000000001', '31313131-1111-4000-a000-000000000001', '31313131-3333-4000-a000-000000000001',
   '31313131-2222-4000-a000-000000000001', '2026-11-02'),
  ('31313131-4444-4000-a000-000000000002', '31313131-1111-4000-a000-000000000001', '31313131-3333-4000-a000-000000000002',
   '31313131-2222-4000-a000-000000000002', '2026-11-20');
insert into public.patient_treatments (id, patient_id, name, start_date, planned_sessions, doctor_id, pricing,
                                       package_price_paise, agreed_price_paise) values
  ('31313131-5555-4000-a000-000000000001', '31313131-1111-4000-a000-000000000001', 'Laser Care', '2026-11-01', 2,
   '31313131-2222-4000-a000-000000000002', 'package', 3500000, 3000000),
  ('31313131-5555-4000-a000-000000000002', '31313131-1111-4000-a000-000000000002', 'Other Treatment', '2026-11-01', 1,
   null, 'package', 0, null);
insert into public.treatment_sessions (id, treatment_id, patient_id, seq, planned_date, actual_date, status, appointment_id) values
  ('31313131-6666-4000-a000-000000000001', '31313131-5555-4000-a000-000000000001', '31313131-1111-4000-a000-000000000001',
   1, '2026-11-01', '2026-11-01', 'done', null),
  ('31313131-6666-4000-a000-000000000002', '31313131-5555-4000-a000-000000000001', '31313131-1111-4000-a000-000000000001',
   2, '2026-11-20', null, 'booked', '31313131-3333-4000-a000-000000000002');
insert into public.admissions (id, patient_id, ip_number, admitted_at) values
  ('31313131-7777-4000-a000-000000000001', '31313131-1111-4000-a000-000000000002', 'IP-CARE-2', '2026-11-03 04:00+00');
create temp table ids on commit drop as
  select (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash') as cash;
grant select on ids to authenticated;

create function pg_temp.bill(p_n int, p_links jsonb, p_patient text default '31313131-1111-4000-a000-000000000001')
returns jsonb language sql as $$
  select public.create_bill('procedure_receipt', p_patient::uuid, p_links, ('31313131-8888-4000-a000-00000000000' || p_n)::uuid)
$$;
grant execute on function pg_temp.bill(int, jsonb, text) to authenticated;
create function pg_temp.links(p_n int)
returns table (visit_id uuid, session_id uuid, treatment_id uuid, doctor_id uuid)
language sql as $$
  select visit_id, session_id, treatment_id, doctor_id from public.bills where id = ('31313131-8888-4000-a000-00000000000' || p_n)::uuid
$$;
grant execute on function pg_temp.links(int) to authenticated;

select pg_temp.login('31313131-0000-4000-a000-0000000000b1');

------------------------------------------------------------------------------
-- What the bill is for follows from what it was made from
------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.bill(1, '{"appointment_id": "31313131-3333-4000-a000-000000000002"}') $$,
  'a bill made from a treatment session''s booking');
select results_eq($$ select * from pg_temp.links(1) $$,
  $$ values ('31313131-4444-4000-a000-000000000002'::uuid, '31313131-6666-4000-a000-000000000002'::uuid,
             '31313131-5555-4000-a000-000000000001'::uuid, '31313131-2222-4000-a000-000000000002'::uuid) $$,
  'it is linked to the visit, the session, the treatment and the visit''s doctor');

select lives_ok($$ select pg_temp.bill(2, '{"session_id": "31313131-6666-4000-a000-000000000001"}') $$,
  'a bill made from a session marked done without a booking');
select results_eq($$ select * from pg_temp.links(2) $$,
  $$ values (null::uuid, '31313131-6666-4000-a000-000000000001'::uuid,
             '31313131-5555-4000-a000-000000000001'::uuid, '31313131-2222-4000-a000-000000000002'::uuid) $$,
  'linked to that session and its treatment, with the treatment''s doctor');

select lives_ok($$ select pg_temp.bill(3, '{"visit_id": "31313131-4444-4000-a000-000000000001"}') $$,
  'a bill for a plain consultation visit');
select results_eq($$ select * from pg_temp.links(3) $$,
  $$ values ('31313131-4444-4000-a000-000000000001'::uuid, null::uuid, null::uuid, '31313131-2222-4000-a000-000000000001'::uuid) $$,
  'linked to the visit only, with the visit''s doctor');

select lives_ok($$ select pg_temp.bill(4, '{}') $$, 'a bill for nothing in particular still works as before');

------------------------------------------------------------------------------
-- Another patient's booking, visit, session or treatment is refused
------------------------------------------------------------------------------
select throws_ok($$ select pg_temp.bill(5, '{"appointment_id": "31313131-3333-4000-a000-000000000001"}', '31313131-1111-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'another patient''s booking is refused');
select throws_ok($$ select pg_temp.bill(5, '{"visit_id": "31313131-4444-4000-a000-000000000001"}', '31313131-1111-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'another patient''s visit is refused');
select throws_ok($$ select pg_temp.bill(5, '{"session_id": "31313131-6666-4000-a000-000000000001"}', '31313131-1111-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'another patient''s session is refused');
select throws_ok($$ select pg_temp.bill(5, '{"treatment_id": "31313131-5555-4000-a000-000000000002"}') $$,
  'P0001', 'invalid_input', 'another patient''s treatment is refused');
select throws_ok($$ select pg_temp.bill(5, '{"session_id": "not-a-uuid"}') $$,
  'P0001', 'invalid_input', 'a broken link is refused with a clear code');

------------------------------------------------------------------------------
-- The bill and the bills list say what it is for
------------------------------------------------------------------------------
select is((public.get_bill('31313131-8888-4000-a000-000000000001') -> 'for') - 'treatment_id' - 'session_id' - 'visit_id' - 'appointment_id',
  '{"treatment": "Laser Care", "category": "procedure", "session_seq": 2, "visit_date": "2026-11-20", "doctor": "Dr Care Laser"}'::jsonb,
  'the bill says: Laser Care, session 2, visit 20/11, Dr Care Laser');
select is((select r -> 'for' ->> 'session_seq' from jsonb_array_elements(
             public.bills_table('{"patient_id": "31313131-1111-4000-a000-000000000001"}') -> 'rows') r
           where r ->> 'id' = '31313131-8888-4000-a000-000000000002'), '1',
  'the bills list says which session too');

------------------------------------------------------------------------------
-- Payments for a treatment / IP stay must be this patient's
------------------------------------------------------------------------------
select throws_ok($$ select public.add_payment(jsonb_build_object('patient_id', '31313131-1111-4000-a000-000000000001', 'kind', 'advance',
  'mode_id', (select cash from ids), 'amount_paise', 1000, 'treatment_id', '31313131-5555-4000-a000-000000000002'), gen_random_uuid()) $$,
  'P0001', 'invalid_input', 'a part payment on another patient''s treatment is refused');
select throws_ok($$ select public.add_payment(jsonb_build_object('patient_id', '31313131-1111-4000-a000-000000000001', 'kind', 'advance',
  'mode_id', (select cash from ids), 'amount_paise', 1000, 'admission_id', '31313131-7777-4000-a000-000000000001'), gen_random_uuid()) $$,
  'P0001', 'invalid_input', 'an advance on another patient''s IP stay is refused');

------------------------------------------------------------------------------
-- Money of the package: session 2's bill ₹5,000 (₹3,000 paid at the desk) + a ₹10,000 part payment
-- for the package; agreed ₹30,000 → billed ₹5,000, paid ₹13,000, due ₹17,000.
------------------------------------------------------------------------------
select lives_ok($$ select public.save_bill('31313131-8888-4000-a000-000000000001', '{}',
  jsonb_build_array(jsonb_build_object('description', 'Laser session', 'rate_paise', 500000, 'qty', 1)), 1) $$, 'session 2 bill lines');
select lives_ok($$ select public.finalize_bill('31313131-8888-4000-a000-000000000001', 2,
  jsonb_build_array(jsonb_build_object('mode_id', (select cash from ids), 'amount_paise', 300000))) $$, 'finalized, ₹3,000 paid');
select lives_ok($$ select public.add_payment(jsonb_build_object('patient_id', '31313131-1111-4000-a000-000000000001', 'kind', 'advance',
  'mode_id', (select cash from ids), 'amount_paise', 1000000, 'treatment_id', '31313131-5555-4000-a000-000000000001'),
  '31313131-9999-4000-a000-000000000001') $$, 'a ₹10,000 part payment for the package');

create temp table card on commit drop as
  select public.patient_treatments_list('31313131-1111-4000-a000-000000000001') -> 0 as c;
select is((select jsonb_build_object('billed', c -> 'billed_paise', 'paid', c -> 'paid_paise', 'due', c -> 'due_paise') from card),
  '{"billed": 500000, "paid": 1300000, "due": 1700000}'::jsonb, 'the treatment shows billed, paid and due');
select is((select c -> 'sessions' -> 1 -> 'bills' -> 0 ->> 'received_paise' from card), '300000',
  'session 2 lists its bill with what was paid on it');

------------------------------------------------------------------------------
-- The patient's bookings list each visit's bills and its treatment session
------------------------------------------------------------------------------
select is((select jsonb_build_object('bills', jsonb_array_length(i -> 'bills'), 'seq', i -> 'session' -> 'seq')
             from jsonb_array_elements(public.patient_appointments('31313131-1111-4000-a000-000000000001') -> 'items') i
            where i ->> 'id' = '31313131-3333-4000-a000-000000000002'),
  '{"bills": 1, "seq": 2}'::jsonb, 'the booking shows its bill and that it is session 2');

select pg_temp.login('31313131-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.patient_appointments('31313131-1111-4000-a000-000000000001') $$,
  'P0001', null, 'sales can''t read a patient''s bookings and bills');

select * from finish();
rollback;
