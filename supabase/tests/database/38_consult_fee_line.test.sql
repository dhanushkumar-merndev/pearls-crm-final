-- The consultation fee is used (Phase 19d): a new surgery bill for a consultation visit starts with a
-- "Consultation – Dr X" line at the doctor's fee; a treatment session's bill, a doctor with no fee and a
-- pharmacy bill get none; the line can be changed like any other.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

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

insert into auth.users (id, email) values ('38383838-0000-4000-a000-0000000000b1', 'fee-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values ('38383838-0000-4000-a000-0000000000b1', 'receptionist', 'Fee Rec', 'feerec');
insert into public.patients (id, uhid, full_name, gender, phone_e164) values
  ('38383838-1111-4000-a000-000000000001', 'FEE-1', 'Fee Patient', 'female', '+919811438001');
insert into public.doctors (id, full_name, display_name, consultation_fee_paise) values
  ('38383838-2222-4000-a000-000000000001', 'Dr Fee Full', 'Dr Fee', 75000),
  ('38383838-2222-4000-a000-000000000002', 'Dr Free', null, 0);
insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, status) values
  ('38383838-3333-4000-a000-000000000001', '38383838-1111-4000-a000-000000000001', '38383838-2222-4000-a000-000000000001',
   '2026-11-10', '2026-11-10 05:30+00', '2026-11-10 05:45+00', 'done'),
  ('38383838-3333-4000-a000-000000000002', '38383838-1111-4000-a000-000000000001', '38383838-2222-4000-a000-000000000002',
   '2026-11-11', '2026-11-11 05:30+00', '2026-11-11 05:45+00', 'done'),
  ('38383838-3333-4000-a000-000000000003', '38383838-1111-4000-a000-000000000001', '38383838-2222-4000-a000-000000000001',
   '2026-11-12', '2026-11-12 05:30+00', '2026-11-12 05:45+00', 'done');
insert into public.visits (id, patient_id, appointment_id, doctor_id, visit_date) values
  ('38383838-4444-4000-a000-000000000001', '38383838-1111-4000-a000-000000000001', '38383838-3333-4000-a000-000000000001',
   '38383838-2222-4000-a000-000000000001', '2026-11-10');
-- Booking 3 is session 1 of a treatment: its bill is the treatment's, not a consultation.
insert into public.patient_treatments (id, patient_id, name, start_date, planned_sessions, doctor_id, pricing, package_price_paise) values
  ('38383838-5555-4000-a000-000000000001', '38383838-1111-4000-a000-000000000001', 'PRP', '2026-11-12', 1,
   '38383838-2222-4000-a000-000000000001', 'package', 0);
insert into public.treatment_sessions (id, treatment_id, patient_id, seq, planned_date, status, appointment_id) values
  ('38383838-6666-4000-a000-000000000001', '38383838-5555-4000-a000-000000000001', '38383838-1111-4000-a000-000000000001',
   1, '2026-11-12', 'done', '38383838-3333-4000-a000-000000000003');

select pg_temp.login('38383838-0000-4000-a000-0000000000b1');

select public.create_bill('procedure_receipt', '38383838-1111-4000-a000-000000000001',
  '{"appointment_id": "38383838-3333-4000-a000-000000000001"}', '38383838-7777-4000-a000-000000000001');
select is((select count(*)::int from public.bill_items where bill_id = '38383838-7777-4000-a000-000000000001'), 1,
  'a consultation''s bill starts with one line');
select is((select description from public.bill_items where bill_id = '38383838-7777-4000-a000-000000000001'),
  'Consultation – Dr Fee', 'the line names the doctor (display name)');
select is((select (rate_paise, kind, service_date)::text from public.bill_items where bill_id = '38383838-7777-4000-a000-000000000001'),
  '(75000,doctor_charge,2026-11-10)', 'at the doctor''s fee, as a doctor charge, on the visit day');
select is((select total_paise from public.bills where id = '38383838-7777-4000-a000-000000000001'), 75000::bigint,
  'the bill total includes it');
select is((select c.code from public.bill_items i join public.lookup_values c on c.id = i.category_id
            where i.bill_id = '38383838-7777-4000-a000-000000000001'), 'consultation', 'under the Consultation category');
-- A retried create gives the same bill back without a second line.
select public.create_bill('procedure_receipt', '38383838-1111-4000-a000-000000000001',
  '{"appointment_id": "38383838-3333-4000-a000-000000000001"}', '38383838-7777-4000-a000-000000000001');
select is((select count(*)::int from public.bill_items where bill_id = '38383838-7777-4000-a000-000000000001'), 1,
  'a retry adds no second line');

select public.create_bill('procedure_receipt', '38383838-1111-4000-a000-000000000001',
  '{"appointment_id": "38383838-3333-4000-a000-000000000002"}', '38383838-7777-4000-a000-000000000002');
select is((select count(*)::int from public.bill_items where bill_id = '38383838-7777-4000-a000-000000000002'), 0,
  'a doctor with no fee: no line');
select public.create_bill('procedure_receipt', '38383838-1111-4000-a000-000000000001',
  '{"appointment_id": "38383838-3333-4000-a000-000000000003"}', '38383838-7777-4000-a000-000000000003');
select is((select count(*)::int from public.bill_items where bill_id = '38383838-7777-4000-a000-000000000003'), 0,
  'a treatment session''s bill: no consultation line');
select public.create_bill('pharmacy_invoice', '38383838-1111-4000-a000-000000000001',
  '{"appointment_id": "38383838-3333-4000-a000-000000000001"}', '38383838-7777-4000-a000-000000000004');
select is((select count(*)::int from public.bill_items where bill_id = '38383838-7777-4000-a000-000000000004'), 0,
  'a pharmacy bill: no consultation line');

select * from finish();
rollback;
