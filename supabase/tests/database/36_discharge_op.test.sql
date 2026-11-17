-- Discharge summary for OP visits (Phase 19b): a summary for a treatment session or a visit, filled
-- with OP values, one per visit, finalize needs a doctor and refuses IP-only placeholders, follow-up
-- from the visit date, print, lists and bill_paperwork. The IP rules are covered by 10_ip_stay.
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
  ('36363636-0000-4000-a000-0000000000b1', 'op-rec@staff.invalid'),
  ('36363636-0000-4000-a000-0000000000c1', 'op-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('36363636-0000-4000-a000-0000000000b1', 'receptionist', 'Op Rec', 'oprec'),
  ('36363636-0000-4000-a000-0000000000c1', 'sales_executive', 'Op Sales', 'opsales');
insert into public.patients (id, uhid, full_name, gender, phone_e164) values
  ('36363636-1111-4000-a000-000000000001', 'OP-1', 'Op Patient', 'female', '+919811436001');
insert into public.doctors (id, full_name, qualification) values ('36363636-2222-4000-a000-000000000001', 'Dr Op Derm', 'MD');
insert into public.discharge_templates (id, name, sections, medications, follow_up_days) values
  ('36363636-9999-4000-a000-000000000001', 'PRP OP (test)',
   '[{"key": "p", "title": "Procedure", "body": "{{He_She}} had {{procedure}} on {{procedure_on}} by {{doctor}}."}]', '[]', 7);
-- PRP: one session done without a booking (so no visit); a separate walk-in visit with no doctor.
insert into public.patient_treatments (id, patient_id, name, start_date, planned_sessions, doctor_id, pricing, package_price_paise,
                                       discharge_template_id) values
  ('36363636-3333-4000-a000-000000000001', '36363636-1111-4000-a000-000000000001', 'PRP', '2026-11-01', 1,
   '36363636-2222-4000-a000-000000000001', 'package', 0, '36363636-9999-4000-a000-000000000001');
insert into public.treatment_sessions (id, treatment_id, patient_id, seq, planned_date, actual_date, status) values
  ('36363636-4444-4000-a000-000000000001', '36363636-3333-4000-a000-000000000001', '36363636-1111-4000-a000-000000000001',
   1, '2026-11-01', '2026-11-01', 'done');
insert into public.visits (id, patient_id, visit_date) values
  ('36363636-5555-4000-a000-000000000001', '36363636-1111-4000-a000-000000000001', '2026-11-05');

select pg_temp.login('36363636-0000-4000-a000-0000000000b1');
select is(jsonb_array_length(public.discharge_op_targets('36363636-1111-4000-a000-000000000001')), 2,
  'the picker lists the walk-in visit and the session done without a booking');
select is((public.discharge_autofill_op(null, '36363636-4444-4000-a000-000000000001')) #>> '{template,id}',
  '36363636-9999-4000-a000-000000000001', 'autofill takes the treatment''s template');
select is((public.discharge_autofill_op(null, '36363636-4444-4000-a000-000000000001')) #>> '{vars,doctor}',
  'Dr Op Derm MD', 'OP doctor = the treatment''s doctor, with qualification');

-- Create an OP summary for the session.
create temp table c on commit drop as select '{"sections": [{"key": "p", "title": "Procedure",
  "body": "{{He_She}} had {{procedure}} on {{procedure_on}} by {{doctor}}."}], "medications": [], "follow_up_days": 7,
  "follow_up_note": "", "doctor_id": null}'::jsonb as content;
grant select on c to authenticated;
select is((public.save_discharge_summary('36363636-6666-4000-a000-000000000001', null, (select content from c), null,
  '36363636-9999-4000-a000-000000000001', null, '36363636-4444-4000-a000-000000000001')) ->> 'kind', 'op',
  'an OP summary is made for the session');
select ok((select admission_id is null and session_id = '36363636-4444-4000-a000-000000000001' and visit_id is null
             from public.discharge_summaries where id = '36363636-6666-4000-a000-000000000001'), 'linked to the session, no stay');
select is((public.save_discharge_summary('36363636-6666-4000-a000-000000000001', null, (select content from c), null,
  null, null, '36363636-4444-4000-a000-000000000001')) ->> 'version', '1', 'a retried create gives the same draft back');
select throws_ok($$ select public.save_discharge_summary(gen_random_uuid(), null, (select content from c), null, null, null,
  '36363636-4444-4000-a000-000000000001') $$, 'P0001', 'duplicate', 'one summary per session');
select is((public.get_discharge_summary('36363636-6666-4000-a000-000000000001')) #>> '{preview,sections,0,body}',
  'She had PRP on 01/11/2026 by Dr Op Derm MD.', 'the preview fills the OP values');
select is((public.get_discharge_summary('36363636-6666-4000-a000-000000000001')) #>> '{op,treatment}', 'PRP',
  'the card says what the visit was for');
select throws_ok($$ select public.save_discharge_summary(gen_random_uuid(), null, (select content from c)) $$,
  'P0001', 'invalid_input', 'neither a stay nor a visit is refused');

-- An IP-only placeholder blocks finalize; without it the summary finalizes and books the follow-up.
select public.save_discharge_summary('36363636-6666-4000-a000-000000000001', null,
  jsonb_set((select content from c), '{sections,0,body}', '"IP {{ip_number}}"'), 1);
select throws_ok($$ select public.finalize_discharge_summary('36363636-6666-4000-a000-000000000001', 2) $$,
  'P0001', 'placeholders_left', 'an IP-only placeholder blocks an OP summary');
select public.save_discharge_summary('36363636-6666-4000-a000-000000000001', null, (select content from c), 2);
select is((public.finalize_discharge_summary('36363636-6666-4000-a000-000000000001', 3)) ->> 'status', 'finalized',
  'the OP summary finalizes');
select is((select patient_snapshot ->> 'kind' from public.discharge_summaries where id = '36363636-6666-4000-a000-000000000001'),
  'op', 'the frozen strip says OP');
select is((select f.due_date from public.followups f join public.discharge_summaries s on s.followup_id = f.id
            where s.id = '36363636-6666-4000-a000-000000000001'), '2026-11-08'::date, 'follow-up 7 days after the procedure');

select is((public.discharge_print_data('36363636-6666-4000-a000-000000000001')) ->> 'copy', 'original', 'printed: original');
select is((public.discharge_print_data('36363636-6666-4000-a000-000000000001', false)) #>> '{patient_strip,treatment}', 'PRP',
  'the print strip shows the procedure');

-- The walk-in visit has no doctor: finalize asks for one.
select public.save_discharge_summary('36363636-6666-4000-a000-000000000002', null,
  jsonb_set((select content from c), '{sections,0,body}', '"Seen on {{visit_on}} by {{doctor}}."'), null, null,
  '36363636-5555-4000-a000-000000000001', null);
select throws_ok($$ select public.finalize_discharge_summary('36363636-6666-4000-a000-000000000002', 1) $$,
  'P0001', 'doctor_required', 'an OP summary needs a doctor');
select public.save_discharge_summary('36363636-6666-4000-a000-000000000002', null,
  jsonb_set(jsonb_set((select content from c), '{sections,0,body}', '"Seen on {{visit_on}} by {{doctor}}."'),
            '{doctor_id}', '"36363636-2222-4000-a000-000000000001"'), 1);
select is((public.finalize_discharge_summary('36363636-6666-4000-a000-000000000002', 2)) ->> 'status', 'finalized',
  'with the signing doctor chosen it finalizes');

-- Lists and paperwork.
select is(((public.discharge_summaries_table('{"patient_id": "36363636-1111-4000-a000-000000000001"}')) -> 'total')::int, 2,
  'the discharge section lists both OP summaries');
select is(((public.discharge_summaries_table('{"patient_id": "36363636-1111-4000-a000-000000000001", "kind": "ip"}')) -> 'total')::int, 0,
  'the kind filter keeps IP only');
select is((public.discharge_op_targets('36363636-1111-4000-a000-000000000001')) -> 0 ->> 'summary_id',
  '36363636-6666-4000-a000-000000000002', 'the picker shows the summary each visit already has');
select public.create_bill('procedure_receipt', '36363636-1111-4000-a000-000000000001',
  '{"session_id": "36363636-4444-4000-a000-000000000001"}', '36363636-7777-4000-a000-000000000001');
select is((public.bill_paperwork('36363636-7777-4000-a000-000000000001')) #>> '{op,summary,id}',
  '36363636-6666-4000-a000-000000000001', 'the session''s bill offers its discharge summary');
select is((public.pharmacy_bill_from_meds('36363636-6666-4000-a000-000000000001', '36363636-7777-4000-a000-000000000002')) #>> '{for,session_id}',
  '36363636-4444-4000-a000-000000000001', 'a pharmacy bill from an OP summary is for that session');

select pg_temp.login('36363636-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.discharge_op_targets('36363636-1111-4000-a000-000000000001') $$,
  'P0001', 'not_allowed', 'sales staff can''t open discharge summaries');

select * from finish();
rollback;
