-- Phase 7: admissions, room days, the final bill (carried-in lines, no double counting,
-- money per episode), discharge summaries (placeholders, checks, follow-up, amend, templates).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(58);

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
  ('aaaaaaaa-0000-4000-a000-00000000000a', 'p7-admin@staff.invalid'),
  ('aaaaaaaa-0000-4000-a000-0000000000b1', 'p7-rec@staff.invalid'),
  ('aaaaaaaa-0000-4000-a000-0000000000c1', 'p7-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('aaaaaaaa-0000-4000-a000-00000000000a', 'admin', 'P7 Admin', 'p7admin'),
  ('aaaaaaaa-0000-4000-a000-0000000000b1', 'receptionist', 'P7 Rec', 'p7rec'),
  ('aaaaaaaa-0000-4000-a000-0000000000c1', 'sales_executive', 'P7 Sales', 'p7sales');
insert into public.patients (id, uhid, full_name, gender, dob) values
  ('aaaaaaaa-1111-4000-a000-000000000001', 'P7-1', 'Asha Rao', 'female', '1990-05-10'),
  ('aaaaaaaa-1111-4000-a000-000000000002', 'P7-2', 'Sam Iyer', 'other', null);
insert into public.doctors (id, full_name, qualification, designation, reg_council, reg_number)
values ('aaaaaaaa-2222-4000-a000-00000000000a', 'Dr P7 Surgeon', 'MS (ENT)', 'Consultant ENT Surgeon', 'KMC', '12345');
insert into public.room_types (id, name, daily_rate_paise, gst_rate_bp) values ('aaaaaaaa-3333-4000-a000-000000000001', 'P7 Semi Deluxe', 200000, 0);
delete from public.number_series where series_key in ('ip_number', 'procedure_receipt', 'final_bill') and fy = private.fy_label(now());
insert into public.number_series (series_key, fy, prefix, format, next_value) values
  ('ip_number', private.fy_label(now()), 'IP', '{prefix}/{fy}/{n}', 7),
  ('procedure_receipt', private.fy_label(now()), 'T', '{prefix}/{fy}/{n}', 1),
  ('final_bill', private.fy_label(now()), 'F', '{prefix}/{fy}/{n}', 1);
update public.app_settings set value = value || '{"ip_number_mode": "separate", "receptionist_max_discount_bp": 2000}' where section = 'billing';
create temp table k on commit drop as
  select (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash') as cash,
         right(private.fy_label(now()), 5) as fy,
         to_char(private.ist(now() - interval '2 days'), 'DD/MM/YYYY') as surgery_on,
         (private.ist(now() - interval '1 hour'))::date + 7 as follow_up;
grant select on k to authenticated;

------------------------------------------------------------------------------
-- Room days: nights (IST midnights crossed), at least 1
------------------------------------------------------------------------------
select is(private.room_days('2026-03-30 10:50+05:30', '2026-03-31 10:50+05:30'), 1, 'admitted 30/03 10:50, out 31/03 10:50 = 1 day (the sample)');
select is(private.room_days('2026-03-30 09:00+05:30', '2026-03-30 18:00+05:30'), 1, 'same-day stay = 1 day (minimum)');
select is(private.room_days('2026-03-30 23:00+05:30', '2026-03-31 01:00+05:30'), 1, 'two hours across midnight = 1 day');
select is(private.room_days('2026-03-28 22:00+05:30', '2026-03-31 08:00+05:30'), 3, 'three midnights = 3 days');

------------------------------------------------------------------------------
-- Admit / discharge
------------------------------------------------------------------------------
select pg_temp.login('aaaaaaaa-0000-4000-a000-0000000000b1');
create temp table a1 on commit drop as select public.admit_patient(jsonb_build_object(
  'patient_id', 'aaaaaaaa-1111-4000-a000-000000000001', 'admitted_at', now() - interval '3 days',
  'room_type_id', 'aaaaaaaa-3333-4000-a000-000000000001', 'room_label', 'SEMI DELUX ROOM/1',
  'procedures', jsonb_build_array('Septoplasty'), 'anaesthesia', 'general anaesthesia', 'diagnosis', 'Deviated nasal septum',
  'surgery_at', now() - interval '2 days',
  'surgeons', jsonb_build_array(jsonb_build_object('doctor_id', 'aaaaaaaa-2222-4000-a000-00000000000a', 'role', 'primary'))),
  'aaaaaaaa-4444-4000-a000-000000000001') as r;
grant select on a1 to authenticated;
select is((select r ->> 'ip_number' from a1), 'IP/' || (select fy from k) || '/7', 'the IP number comes from its own series');
select is((public.admit_patient('{"patient_id": "aaaaaaaa-1111-4000-a000-000000000001"}', 'aaaaaaaa-4444-4000-a000-000000000001')) ->> 'id',
  'aaaaaaaa-4444-4000-a000-000000000001', 'retrying the same admission creates nothing new');
select throws_ok($$ select public.admit_patient('{"patient_id": "aaaaaaaa-1111-4000-a000-000000000001"}', gen_random_uuid()) $$,
  'P0001', 'duplicate', 'a patient can''t be admitted twice at once');
select is((select (r -> 'surgeons' -> 0 ->> 'name') from a1), 'Dr P7 Surgeon', 'surgeons are kept with the stay');
select throws_ok($$ select public.discharge_patient('aaaaaaaa-4444-4000-a000-000000000001', now() - interval '4 days') $$,
  'P0001', 'dates_invalid', 'discharge can''t be before admission');
select lives_ok($$ select public.discharge_patient('aaaaaaaa-4444-4000-a000-000000000001', now() - interval '1 hour') $$, 'discharge');
select throws_ok($$ select public.update_admission('aaaaaaaa-4444-4000-a000-000000000001', '{"room_label": "x"}',
  (select version from public.admissions where id = 'aaaaaaaa-4444-4000-a000-000000000001')) $$,
  'P0001', 'not_allowed', 'after discharge, reception can''t edit the stay');

------------------------------------------------------------------------------
-- Interim bills for the stay
------------------------------------------------------------------------------
-- r1: ₹1,000 incl. 18% GST, ₹400 paid at the desk. r2: ₹500, unpaid.
create function pg_temp.receipt(p_id uuid, p_rate bigint, p_gst integer, p_paid bigint)
returns void
language plpgsql
as $$
begin
  perform public.create_bill('procedure_receipt', 'aaaaaaaa-1111-4000-a000-000000000001',
                             '{"admission_id": "aaaaaaaa-4444-4000-a000-000000000001"}', p_id);
  perform public.save_bill(p_id, '{"tax_inclusive": true}', jsonb_build_array(jsonb_build_object(
    'description', 'P7 procedure', 'rate_paise', p_rate, 'qty', 1, 'gst_rate_bp', p_gst)), 1);
  perform public.finalize_bill(p_id, 2, case when p_paid > 0 then jsonb_build_array(jsonb_build_object(
    'mode_id', (select cash from k), 'amount_paise', p_paid)) else '[]'::jsonb end);
end;
$$;
grant execute on function pg_temp.receipt(uuid, bigint, integer, bigint) to authenticated;
select lives_ok($$ select pg_temp.receipt('aaaaaaaa-5555-4000-a000-000000000001', 100000, 1800, 40000) $$, 'interim receipt 1 (₹1,000 incl. GST, ₹400 paid)');
select lives_ok($$ select pg_temp.receipt('aaaaaaaa-5555-4000-a000-000000000002', 50000, 0, 0) $$, 'interim receipt 2 (₹500, unpaid)');

------------------------------------------------------------------------------
-- The final bill
------------------------------------------------------------------------------
select lives_ok($$ select public.create_bill('final_bill', 'aaaaaaaa-1111-4000-a000-000000000001',
  '{"admission_id": "aaaaaaaa-4444-4000-a000-000000000001"}', 'aaaaaaaa-5555-4000-a000-0000000000f1') $$, 'a draft final bill for the stay');
create temp table af on commit drop as select public.final_bill_autofill('aaaaaaaa-5555-4000-a000-0000000000f1') as r;
grant select on af to authenticated;
select is((select jsonb_array_length(r -> 'candidates') from af where true), 2, 'autofill offers the two interim bills');
select is((select r -> 'lines' -> 0 ->> 'qty' from af), '3', 'room line: 3 nights');
select is((select r -> 'lines' -> 0 ->> 'rate_paise' from af), '200000', 'at the room''s daily rate');
-- Own lines (exclusive of tax on this bill) + carry both interim bills.
select lives_ok($$ select public.save_bill('aaaaaaaa-5555-4000-a000-0000000000f1', '{"tax_inclusive": false}',
  (select jsonb_build_array(r -> 'lines' -> 0) from af), 1) $$, 'save the room line');
select lives_ok($$ select public.set_carried_bills('aaaaaaaa-5555-4000-a000-0000000000f1', 2,
  array['aaaaaaaa-5555-4000-a000-000000000001', 'aaaaaaaa-5555-4000-a000-000000000002']::uuid[]) $$, 'carry the interim bills');
select is((select array[total_paise, carried_in_paise] from public.bills where id = 'aaaaaaaa-5555-4000-a000-0000000000f1'),
  array[600000::bigint, 150000::bigint], 'own lines ₹6,000; carried in ₹1,500');
select is((select total_paise from public.bill_items where bill_id = 'aaaaaaaa-5555-4000-a000-0000000000f1' and kind = 'carried_in'
             and description = 'P7 procedure' and gst_rate_bp = 1800),
  100000::bigint, 'a carried line keeps its original amount even though this bill is tax-exclusive');
select is(((public.get_bill('aaaaaaaa-5555-4000-a000-0000000000f1')) ->> 'received_paise')::bigint, 40000::bigint,
  'received already counts the ₹400 paid on the interim bill');
-- A second final bill can't take the same interim bills.
select lives_ok($$ select public.create_bill('final_bill', 'aaaaaaaa-1111-4000-a000-000000000001', '{}', 'aaaaaaaa-5555-4000-a000-0000000000f2') $$,
  'a second draft final bill');
select lives_ok($$ select public.finalize_bill('aaaaaaaa-5555-4000-a000-0000000000f1', 3,
  jsonb_build_array(jsonb_build_object('mode_id', (select cash from k), 'amount_paise', 650000))) $$,
  'finalize with ₹6,500 paid: own ₹6,000 first, then the interim bills');
select is((select array_agg(consolidated_into_id::text order by id) from public.bills
            where id in ('aaaaaaaa-5555-4000-a000-000000000001', 'aaaaaaaa-5555-4000-a000-000000000002')),
  array['aaaaaaaa-5555-4000-a000-0000000000f1', 'aaaaaaaa-5555-4000-a000-0000000000f1'], 'both interim bills are stamped "included in" it');
select throws_ok($$ select public.set_carried_bills('aaaaaaaa-5555-4000-a000-0000000000f2', 1,
  array['aaaaaaaa-5555-4000-a000-000000000001']::uuid[]) $$, 'P0001', 'already_in_final_bill',
  'an interim bill can''t go into a second final bill');
select is((select coalesce(sum(a.amount_paise), 0)::bigint from public.payment_allocations a where a.bill_id = 'aaaaaaaa-5555-4000-a000-000000000001'),
  90000::bigint, 'the spill-over paid ₹500 of interim bill 1 (₹400 + ₹500 of ₹1,000)');
select is(((public.get_bill('aaaaaaaa-5555-4000-a000-0000000000f1')) ->> 'received_paise')::bigint, 690000::bigint,
  'the final bill shows ₹6,900 received of ₹7,500');
select lives_ok($$ select public.add_payment(jsonb_build_object('patient_id', 'aaaaaaaa-1111-4000-a000-000000000001',
  'mode_id', (select cash from k), 'amount_paise', 60000,
  'allocations', jsonb_build_array(jsonb_build_object('bill_id', 'aaaaaaaa-5555-4000-a000-0000000000f1', 'amount_paise', 60000))),
  gen_random_uuid()) $$, 'the last ₹600 against the final bill');
select is(((public.get_bill('aaaaaaaa-5555-4000-a000-0000000000f1')) ->> 'received_paise')::bigint, 750000::bigint, 'fully paid');
select throws_ok($$ select public.add_payment(jsonb_build_object('patient_id', 'aaaaaaaa-1111-4000-a000-000000000001',
  'mode_id', (select cash from k), 'amount_paise', 1,
  'allocations', jsonb_build_array(jsonb_build_object('bill_id', 'aaaaaaaa-5555-4000-a000-0000000000f1', 'amount_paise', 1))),
  gen_random_uuid()) $$, 'P0001', 'over_allocated', 'nothing more can be paid against it');
select is(((public.patient_balance('aaaaaaaa-1111-4000-a000-000000000001')) ->> 'billed_paise')::bigint, 750000::bigint,
  'billed counts every line once: ₹1,000 + ₹500 + ₹6,000, not the carried lines again');
select pg_temp.login('aaaaaaaa-0000-4000-a000-00000000000a');
select throws_ok($$ select public.cancel_bill('aaaaaaaa-5555-4000-a000-000000000001', 'mistake') $$,
  'P0001', 'bill_locked', 'an interim bill inside a final bill can''t be cancelled');
select lives_ok($$ select public.cancel_bill('aaaaaaaa-5555-4000-a000-0000000000f1', 'redo the final bill') $$, 'cancel the final bill');
select is((select count(*)::int from public.bills where consolidated_into_id = 'aaaaaaaa-5555-4000-a000-0000000000f1'), 0,
  'cancelling it releases the interim bills');

------------------------------------------------------------------------------
-- Discharge summary
------------------------------------------------------------------------------
select pg_temp.login('aaaaaaaa-0000-4000-a000-0000000000b1');
select is((public.discharge_autofill('aaaaaaaa-4444-4000-a000-000000000001')) -> 'vars' ->> 'He_She', 'She', 'female patient → She');
create function pg_temp.content(p_body text)
returns jsonb language sql as $$
  select jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('key', 'procedure', 'title', 'Procedure', 'body', p_body)),
    'medications', '[{"name": "Tab P7", "dose": "1", "frequency": "twice a day", "duration": "5 days", "instructions": "after food"}]'::jsonb,
    'follow_up_days', 7, 'doctor_id', 'aaaaaaaa-2222-4000-a000-00000000000a');
$$;
grant execute on function pg_temp.content(text) to authenticated;
select lives_ok($$ select public.save_discharge_summary('aaaaaaaa-6666-4000-a000-000000000001', 'aaaaaaaa-4444-4000-a000-000000000001',
  pg_temp.content('{{He_She}} underwent {{procedure}} on {{surgery_on}}. Blood group {{blood_group}}.')) $$, 'start a summary');
select throws_ok($$ select public.save_discharge_summary(gen_random_uuid(), 'aaaaaaaa-4444-4000-a000-000000000001', '{}') $$,
  'P0001', 'duplicate', 'one summary per stay');
select throws_ok($$ select public.finalize_discharge_summary('aaaaaaaa-6666-4000-a000-000000000001', 1) $$,
  'P0001', 'placeholders_left', 'an unknown {{…}} left in the text blocks finalize');
select lives_ok($$ select public.save_discharge_summary('aaaaaaaa-6666-4000-a000-000000000001', 'aaaaaaaa-4444-4000-a000-000000000001',
  pg_temp.content('{{He_She}} underwent {{procedure}} on {{surgery_on}} under {{anaesthesia}}. {{His_Her}} recovery was smooth.'), 1) $$,
  'fix the text');
select lives_ok($$ select public.finalize_discharge_summary('aaaaaaaa-6666-4000-a000-000000000001', 2) $$, 'finalize');
select is((select rendered -> 'sections' -> 0 ->> 'body' from public.discharge_summaries where id = 'aaaaaaaa-6666-4000-a000-000000000001'),
  'She underwent Septoplasty on ' || (select surgery_on from k) || ' under general anaesthesia. Her recovery was smooth.',
  'the frozen text says "She … Her" for a female patient');
select is((select patient_snapshot -> 'signature' ->> 'reg_number' from public.discharge_summaries where id = 'aaaaaaaa-6666-4000-a000-000000000001'),
  '12345', 'the signature block has the doctor''s registration number');
select is((select due_date from public.followups where ref_id = 'aaaaaaaa-6666-4000-a000-000000000001'),
  (select follow_up from k), 'a follow-up is created 7 days after discharge');
select throws_ok($$ select public.save_discharge_summary('aaaaaaaa-6666-4000-a000-000000000001', 'aaaaaaaa-4444-4000-a000-000000000001',
  pg_temp.content('x'), 3) $$, 'P0001', 'bill_locked', 'a finalized summary can''t be edited at the desk');
select is((public.save_discharge_template('aaaaaaaa-6666-4000-a000-000000000001', 'P7 Septoplasty')) -> 'sections' -> 0 ->> 'body',
  '{{He_She}} underwent {{procedure}} on {{surgery_on}} under {{anaesthesia}}. {{His_Her}} recovery was smooth.',
  'saving as a template keeps the placeholders, not the patient''s details');
select pg_temp.login('aaaaaaaa-0000-4000-a000-00000000000a');
select lives_ok($$ select public.amend_discharge_summary('aaaaaaaa-6666-4000-a000-000000000001',
  pg_temp.content('{{He_She}} underwent {{procedure}} on {{surgery_on}}.'), 'shorter text') $$, 'admin amends it');
select is((select count(*)::int from public.discharge_summary_versions where summary_id = 'aaaaaaaa-6666-4000-a000-000000000001'), 1,
  'the earlier version is kept');

-- Patient 2 (gender "other"): not discharged → no surgeon → surgery outside the stay.
select pg_temp.login('aaaaaaaa-0000-4000-a000-0000000000b1');
select lives_ok($$ select public.admit_patient(jsonb_build_object('patient_id', 'aaaaaaaa-1111-4000-a000-000000000002',
  'admitted_at', now() - interval '2 days', 'procedures', jsonb_build_array('Rhinoplasty')), 'aaaaaaaa-4444-4000-a000-000000000002') $$,
  'admit patient 2 (no surgeon yet)');
select is((public.discharge_autofill('aaaaaaaa-4444-4000-a000-000000000002')) -> 'vars' ->> 'his_her', 'their', 'gender "other" → their');
select lives_ok($$ select public.save_discharge_summary('aaaaaaaa-6666-4000-a000-000000000002', 'aaaaaaaa-4444-4000-a000-000000000002',
  pg_temp.content('{{He_She}} underwent {{procedure}}.')) $$, 'a summary while still admitted');
select throws_ok($$ select public.finalize_discharge_summary('aaaaaaaa-6666-4000-a000-000000000002', 1) $$,
  'P0001', 'not_discharged', 'a summary is finalized only after discharge');
select lives_ok($$ select public.discharge_patient('aaaaaaaa-4444-4000-a000-000000000002') $$, 'discharge patient 2');
select throws_ok($$ select public.finalize_discharge_summary('aaaaaaaa-6666-4000-a000-000000000002', 1) $$,
  'P0001', 'surgeon_required', 'at least one surgeon is needed');
select pg_temp.login('aaaaaaaa-0000-4000-a000-00000000000a');
select lives_ok($$ select public.update_admission('aaaaaaaa-4444-4000-a000-000000000002', jsonb_build_object(
  'surgery_at', now() - interval '5 days',
  'surgeons', jsonb_build_array(jsonb_build_object('doctor_id', 'aaaaaaaa-2222-4000-a000-00000000000a'))),
  (select version from public.admissions where id = 'aaaaaaaa-4444-4000-a000-000000000002'), 'add surgeon') $$,
  'admin adds the surgeon (with a wrong surgery date)');
select throws_ok($$ select public.finalize_discharge_summary('aaaaaaaa-6666-4000-a000-000000000002', 1) $$,
  'P0001', 'dates_invalid', 'surgery outside the stay is refused');

------------------------------------------------------------------------------
-- Roles
------------------------------------------------------------------------------
select pg_temp.login('aaaaaaaa-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.admissions), 0, 'sales staff can''t see IP stays');
select throws_ok($$ select public.admit_patient('{"patient_id": "aaaaaaaa-1111-4000-a000-000000000002"}', gen_random_uuid()) $$,
  'P0001', 'not_allowed', 'nor admit anyone');

select * from finish();
rollback;
