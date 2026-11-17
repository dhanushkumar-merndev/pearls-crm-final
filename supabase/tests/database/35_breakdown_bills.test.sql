-- Breakdown bill for insurance (Phase 19a): filled from a surgery's chosen sessions and bills, edited
-- freely, finalized with its own number, amended (old copy kept) or cancelled by an admin. It never
-- counts as money owed. Plus the section lists (breakdown bills, discharge summaries), bills_table's
-- bill_types filter and bill_paperwork.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(45);

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
  ('35353535-0000-4000-a000-00000000000a', 'bk-admin@staff.invalid'),
  ('35353535-0000-4000-a000-0000000000b1', 'bk-rec@staff.invalid'),
  ('35353535-0000-4000-a000-0000000000c1', 'bk-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('35353535-0000-4000-a000-00000000000a', 'admin', 'Bk Admin', 'bkadmin'),
  ('35353535-0000-4000-a000-0000000000b1', 'receptionist', 'Bk Rec', 'bkrec'),
  ('35353535-0000-4000-a000-0000000000c1', 'sales_executive', 'Bk Sales', 'bksales');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('35353535-1111-4000-a000-000000000001', 'BK-1', 'Breakdown Insured', '+919811435001'),
  ('35353535-1111-4000-a000-000000000002', 'BK-2', 'Breakdown Other', '+919811435002');
insert into public.doctors (id, full_name) values ('35353535-2222-4000-a000-000000000001', 'Dr Bk Surgeon');
update public.app_settings set value = value || '{"round_to_rupee": false}' where section = 'billing';
delete from public.number_series where series_key = 'breakdown_bill' and fy = private.fy_label(now());
insert into public.number_series (series_key, fy, prefix, format, next_value) values
  ('breakdown_bill', private.fy_label(now()), 'BK', '{prefix}/{fy}/{n}', 7);

-- A hair-transplant surgery in 2 sessions with an IP stay; another patient's bill.
insert into public.patient_treatments (id, patient_id, name, start_date, planned_sessions, doctor_id, pricing, package_price_paise) values
  ('35353535-3333-4000-a000-000000000001', '35353535-1111-4000-a000-000000000001', 'Hair transplant', '2026-11-01', 2,
   '35353535-2222-4000-a000-000000000001', 'package', 0);
insert into public.treatment_sessions (id, treatment_id, patient_id, seq, planned_date, actual_date, status) values
  ('35353535-4444-4000-a000-000000000001', '35353535-3333-4000-a000-000000000001', '35353535-1111-4000-a000-000000000001',
   1, '2026-11-01', '2026-11-01', 'done'),
  ('35353535-4444-4000-a000-000000000002', '35353535-3333-4000-a000-000000000001', '35353535-1111-4000-a000-000000000001',
   2, '2026-11-08', '2026-11-08', 'done');
insert into public.admissions (id, patient_id, treatment_id, ip_number, admitted_at) values
  ('35353535-5555-4000-a000-000000000001', '35353535-1111-4000-a000-000000000001', '35353535-3333-4000-a000-000000000001',
   'IP-BK-1', '2026-11-08 03:00+00');
insert into public.admission_surgeons (admission_id, doctor_id) values
  ('35353535-5555-4000-a000-000000000001', '35353535-2222-4000-a000-000000000001');
create temp table k on commit drop as select
  (select id from public.lookup_values where kind = 'bill_category' and code = 'procedure') as procedure,
  (select id from public.lookup_values where kind = 'bill_category' and code = 'consumables') as consumables,
  (select id from public.lookup_values where kind = 'bill_category' and code = 'room') as room,
  (select id from public.lookup_values where kind = 'bill_category' and code = 'surgeon') as surgeon;
grant select on k to authenticated;
create temp table fy on commit drop as select right(private.fy_label(now()), 5) as short;
grant select on fy to authenticated;

create function pg_temp.receipt(p_id uuid, p_patient uuid, p_links jsonb, p_lines jsonb)
returns void
language plpgsql
as $$
begin
  perform public.create_bill('procedure_receipt', p_patient, p_links, p_id);
  perform public.save_bill(p_id, '{"tax_inclusive": true}', p_lines, 1);
  perform public.finalize_bill(p_id, 2);
end;
$$;
grant execute on function pg_temp.receipt(uuid, uuid, jsonb, jsonb) to authenticated;

select pg_temp.login('35353535-0000-4000-a000-0000000000b1');
-- r1 (session 1): surgeon fee ₹80,000 + consumables kit ₹2,000 incl. 18% GST.
-- r2 (session 2 + the stay): dressing ₹500. f1 (the stay's final bill): room ₹3,000 + r2 carried in.
select lives_ok($$ select pg_temp.receipt('35353535-6666-4000-a000-000000000001', '35353535-1111-4000-a000-000000000001',
  '{"session_id": "35353535-4444-4000-a000-000000000001"}',
  jsonb_build_array(
    jsonb_build_object('description', 'Surgeon fee', 'rate_paise', 8000000, 'qty', 1, 'category_id', (select procedure from k)),
    jsonb_build_object('description', 'Consumables kit', 'rate_paise', 200000, 'qty', 1, 'gst_rate_bp', 1800,
                       'category_id', (select consumables from k)))) $$, 'session 1 surgery bill');
select lives_ok($$ select pg_temp.receipt('35353535-6666-4000-a000-000000000002', '35353535-1111-4000-a000-000000000001',
  '{"session_id": "35353535-4444-4000-a000-000000000002", "admission_id": "35353535-5555-4000-a000-000000000001"}',
  jsonb_build_array(jsonb_build_object('description', 'Dressing', 'rate_paise', 50000, 'qty', 1, 'category_id', (select procedure from k)))) $$,
  'session 2 surgery bill (during the stay)');
select lives_ok($$ select public.create_bill('final_bill', '35353535-1111-4000-a000-000000000001',
  '{"admission_id": "35353535-5555-4000-a000-000000000001"}', '35353535-6666-4000-a000-0000000000f1') $$, 'draft final bill');
select lives_ok($$ select public.save_bill('35353535-6666-4000-a000-0000000000f1', '{"tax_inclusive": true}',
  jsonb_build_array(jsonb_build_object('description', 'Room', 'rate_paise', 300000, 'qty', 1, 'category_id', (select room from k))), 1) $$,
  'final bill: own room line');
select lives_ok($$ select public.set_carried_bills('35353535-6666-4000-a000-0000000000f1', 2,
  array['35353535-6666-4000-a000-000000000002']::uuid[]) $$, 'final bill carries the session 2 bill');
select lives_ok($$ select public.finalize_bill('35353535-6666-4000-a000-0000000000f1', 3) $$, 'final bill finalized');
select lives_ok($$ select pg_temp.receipt('35353535-6666-4000-a000-000000000009', '35353535-1111-4000-a000-000000000002', '{}',
  jsonb_build_array(jsonb_build_object('description', 'Other', 'rate_paise', 10000, 'qty', 1))) $$, 'another patient''s bill');

-- Money before any breakdown exists.
create temp table money_before on commit drop as select
  ((public.patient_dues('35353535-1111-4000-a000-000000000001')) ->> 'total_due_paise')::bigint as due,
  ((public.bills_table('{"patient_id": "35353535-1111-4000-a000-000000000001"}')) -> 'summary' ->> 'billed_paise')::bigint as billed;
grant select on money_before to authenticated;

------------------------------------------------------------------------------
-- What it can be filled from
------------------------------------------------------------------------------
create temp table src on commit drop as select public.breakdown_sources('35353535-1111-4000-a000-000000000001') as r;
grant select on src to authenticated;
select is((select jsonb_array_length(r -> 'treatments' -> 0 -> 'sessions') from src), 2, 'sources: the surgery with its 2 sessions');
select is((select r -> 'treatments' -> 0 -> 'sessions' -> 0 -> 'bills' -> 0 ->> 'id' from src), '35353535-6666-4000-a000-000000000001',
  'session 1 lists its surgery bill');
select is((select r -> 'treatments' -> 0 -> 'stays' -> 0 -> 'bills' -> 1 ->> 'id' from src), '35353535-6666-4000-a000-0000000000f1',
  'the stay lists its final bill');

------------------------------------------------------------------------------
-- Create: lines filled from the chosen bills
------------------------------------------------------------------------------
create temp table b1 on commit drop as select public.create_breakdown_bill('35353535-1111-4000-a000-000000000001',
  '{"session_ids": ["35353535-4444-4000-a000-000000000001", "35353535-4444-4000-a000-000000000002"],
    "admission_id": "35353535-5555-4000-a000-000000000001",
    "bill_ids": ["35353535-6666-4000-a000-000000000001", "35353535-6666-4000-a000-000000000002", "35353535-6666-4000-a000-0000000000f1"]}',
  '35353535-7777-4000-a000-000000000001') as r;
grant select on b1 to authenticated;
select is((select jsonb_array_length(r -> 'lines') from b1), 4,
  '4 lines: surgeon fee, kit, dressing, room (the dressing carried into the final bill is not counted twice)');
select is((select (r ->> 'total_paise')::bigint from b1), 8000000 + 200000 + 50000 + 300000::bigint, 'total = the lines');
select is((select (r ->> 'billed_ref_paise')::bigint from b1), 8550000::bigint, 'billed for the chosen bills: ₹85,500');
select is((select r -> 'lines' -> 0 ->> 'description' from b1), 'Surgeon fee', 'lines go by category (procedure first)');
select is((select l ->> 'category_code' from b1, jsonb_array_elements(r -> 'lines') l where l ->> 'description' = 'Consumables kit'),
  'consumables', 'a line keeps its category');
select is((select r ->> 'treatment_id' from b1), '35353535-3333-4000-a000-000000000001', 'the surgery comes from the stay');
select is((select r ->> 'doctor_id' from b1), '35353535-2222-4000-a000-000000000001', 'doctor = the stay''s surgeon');
select is((public.create_breakdown_bill('35353535-1111-4000-a000-000000000001', '{}', '35353535-7777-4000-a000-000000000001')) ->> 'version',
  '1', 'a retried create gives the same draft back');
select throws_ok($$ select public.create_breakdown_bill('35353535-1111-4000-a000-000000000001',
  '{"bill_ids": ["35353535-6666-4000-a000-000000000009"]}', gen_random_uuid()) $$,
  'P0001', 'invalid_input', 'another patient''s bill is refused');

------------------------------------------------------------------------------
-- Edit freely: split the surgeon fee, change amounts, add a line
------------------------------------------------------------------------------
create temp table e1 on commit drop as select public.save_breakdown_bill('35353535-7777-4000-a000-000000000001', 1,
  '{"insurer": "Star Health", "policy_no": "P-123", "claim_no": "C-9"}',
  jsonb_build_array(
    jsonb_build_object('description', 'Surgeon fee', 'qty', 1, 'unit_paise', 5000000, 'amount_paise', 5000000, 'category_id', (select surgeon from k)),
    jsonb_build_object('description', 'OT charges', 'qty', 1, 'unit_paise', 3000000, 'category_id', (select procedure from k)),
    jsonb_build_object('description', 'Consumables kit', 'qty', 2, 'unit_paise', 100000, 'gst_rate_bp', 1800),
    jsonb_build_object('description', 'Room', 'qty', 2, 'unit_paise', 150000, 'amount_paise', 350000, 'service_date', '2026-11-08'))) as r;
grant select on e1 to authenticated;
select is((select (r ->> 'total_paise')::bigint from e1), 5000000 + 3000000 + 200000 + 350000::bigint,
  'any amounts: the total follows the lines (no match with the bills needed)');
select is((select r -> 'lines' -> 1 ->> 'amount_paise' from e1), '3000000', 'a missing amount = qty × unit');
select is((select r ->> 'insurer' from e1), 'Star Health', 'insurance details saved');
select throws_ok($$ select public.save_breakdown_bill('35353535-7777-4000-a000-000000000001', 1, '{}', '[]') $$,
  'P0001', 'stale_version', 'saving an old copy is refused');
select throws_ok($$ select public.save_breakdown_bill('35353535-7777-4000-a000-000000000001', 2, '{}',
  '[{"description": " ", "amount_paise": 100}]') $$, 'P0001', 'invalid_input', 'a line needs a description');

------------------------------------------------------------------------------
-- Finalize: number, frozen facts, locked; money untouched
------------------------------------------------------------------------------
create temp table f on commit drop as select public.finalize_breakdown_bill('35353535-7777-4000-a000-000000000001', 2) as r;
grant select on f to authenticated;
select is((select r ->> 'bb_no' from f), (select 'BK/' || short || '/7' from fy), 'numbered from its own series');
select is((select patient_snapshot ->> 'ip_number' from public.breakdown_bills where id = '35353535-7777-4000-a000-000000000001'),
  'IP-BK-1', 'the stay is frozen on it');
select throws_ok($$ select public.save_breakdown_bill('35353535-7777-4000-a000-000000000001', 3, '{}', '[]') $$,
  'P0001', 'bill_locked', 'a finalized breakdown is saved as it is');
select is(((public.patient_dues('35353535-1111-4000-a000-000000000001')) ->> 'total_due_paise')::bigint, (select due from money_before),
  'the patient owes the same as before');
select is(((public.bills_table('{"patient_id": "35353535-1111-4000-a000-000000000001"}')) -> 'summary' ->> 'billed_paise')::bigint,
  (select billed from money_before), 'billed stays the same');
select is((select r ->> 'copy' from (select public.breakdown_print_data('35353535-7777-4000-a000-000000000001') as r) x), 'original',
  'first print is the original');
select is((select r ->> 'copy' from (select public.breakdown_print_data('35353535-7777-4000-a000-000000000001') as r) x), 'duplicate',
  'then a duplicate copy');

------------------------------------------------------------------------------
-- Lists, paperwork, filters
------------------------------------------------------------------------------
select is(((public.breakdown_bills_table('{"patient_id": "35353535-1111-4000-a000-000000000001"}')) ->> 'total')::int, 1,
  'breakdown bills list');
select is(((public.bill_paperwork('35353535-6666-4000-a000-000000000001')) -> 'breakdowns' -> 0 ->> 'id'),
  '35353535-7777-4000-a000-000000000001', 'the surgery bill shows its breakdown bill');
select is(((public.bill_paperwork('35353535-6666-4000-a000-0000000000f1')) -> 'admission' ->> 'ip_number'), 'IP-BK-1',
  'the final bill knows its stay (for the discharge summary)');
select is(((public.bills_table('{"patient_id": "35353535-1111-4000-a000-000000000001", "bill_types": ["final_bill"]}')) ->> 'total')::int,
  1, 'bills_table: several-types filter');
select is(((public.discharge_summaries_table('{"patient_id": "35353535-1111-4000-a000-000000000001"}')) ->> 'total')::int, 0,
  'discharge summaries list (none yet)');

------------------------------------------------------------------------------
-- Refill a second draft, discard it; amend and cancel (admin only)
------------------------------------------------------------------------------
select lives_ok($$ select public.create_breakdown_bill('35353535-1111-4000-a000-000000000001', '{}', '35353535-7777-4000-a000-000000000002') $$,
  'an empty draft');
select is((public.breakdown_refill('35353535-7777-4000-a000-000000000002', 1,
  '{"bill_ids": ["35353535-6666-4000-a000-000000000002"]}')) -> 'lines' -> 0 ->> 'description', 'Dressing', 'fill again from another bill');
select lives_ok($$ select public.discard_breakdown_bill('35353535-7777-4000-a000-000000000002') $$, 'a draft can be thrown away');
select throws_ok($$ select public.amend_breakdown_bill('35353535-7777-4000-a000-000000000001', '{}', '[]', 'typo fix') $$,
  'P0001', 'not_allowed', 'reception can''t amend a finalized breakdown');

select pg_temp.login('35353535-0000-4000-a000-00000000000a');
select is((public.amend_breakdown_bill('35353535-7777-4000-a000-000000000001', '{}',
  '[{"description": "Package", "amount_paise": 9000000}]', 'insurer asked for one line')) ->> 'total_paise', '9000000',
  'admin amends');
select is((select count(*)::int from public.breakdown_bill_versions where breakdown_id = '35353535-7777-4000-a000-000000000001'), 1,
  'the old copy is kept');
select is((public.cancel_breakdown_bill('35353535-7777-4000-a000-000000000001', 'wrong insurer')) ->> 'status', 'cancelled',
  'admin cancels');

------------------------------------------------------------------------------
-- Sales can't see or make breakdown bills
------------------------------------------------------------------------------
select pg_temp.login('35353535-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.breakdown_sources('35353535-1111-4000-a000-000000000001') $$, 'P0001', 'not_allowed',
  'sales can''t open the sources');
select is((select count(*)::int from public.breakdown_bills), 0, 'and read no breakdown bills');

select * from finish();
rollback;
