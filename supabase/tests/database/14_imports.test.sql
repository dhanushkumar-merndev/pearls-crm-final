-- Import checks: the check run finds everything the import would refuse, with a column and a stable code.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

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
  ('14141414-0000-4000-a000-00000000000a', 'imp-admin@staff.invalid'),
  ('14141414-0000-4000-a000-0000000000b1', 'imp-rec@staff.invalid'),
  ('14141414-0000-4000-a000-0000000000c1', 'imp-sm@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('14141414-0000-4000-a000-00000000000a', 'admin', 'Imp Admin', 'impadmin'),
  ('14141414-0000-4000-a000-0000000000b1', 'receptionist', 'Imp Rec', 'imprec'),
  ('14141414-0000-4000-a000-0000000000c1', 'sales_manager', 'Imp SM', 'impsm');

select pg_temp.login('14141414-0000-4000-a000-00000000000a');

-- Patients
create temp table rows_p on commit drop as select public.import_patients('[
  {"full_name": "Imp Good", "phone_e164": "+919811100001", "uhid": "IMPCHK-1"},
  {"full_name": "Imp Bad Phone", "phone_e164": "98111"},
  {"full_name": "Imp Long City", "city": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},
  {"full_name": "Imp Same UHID", "uhid": "impchk-1"},
  {"full_name": "Imp Bad Pin", "pincode": "012345"}
]'::jsonb, true) as r;
grant select on rows_p to authenticated;
select is((select (r ->> 'ok')::int from rows_p), 1, 'patients check run: one good row');
select is((select jsonb_agg(e -> 'field' order by (e ->> 'row')::int) from rows_p, jsonb_array_elements(r -> 'errors') e),
  '["phone_e164", "city", "uhid", "pincode"]'::jsonb, 'each problem names its column (phone, too-long city, UHID twice in the file, pincode)');
select is((select jsonb_agg(distinct e ->> 'message') from rows_p, jsonb_array_elements(r -> 'errors') e),
  '["duplicate", "invalid_input"]'::jsonb, 'only stable codes, never raw database text');
select is((select count(*)::int from public.patients where full_name like 'Imp %'), 0, 'the check run saves nothing');
select is((public.import_patients('[{"full_name": "Imp Good", "phone_e164": "+919811100001", "uhid": "IMPCHK-1"}]', false)) ->> 'ok', '1',
  'the real import saves the good row');
select is((public.import_patients('[{"full_name": "Imp Again", "uhid": "IMPCHK-1"}]', true)) -> 'errors' -> 0 ->> 'message', 'duplicate',
  'an existing UHID is reported');
select is((public.import_patients('[1, "x"]', true)) -> 'errors' -> 0 ->> 'field', 'row', 'a row that is not an object is refused');

-- Opening stock: the same batch twice in one file
select is((public.import_opening_stock('[
  {"name": "Imp Tab", "batch_no": "b1", "expiry_date": "2032-01-01", "qty": 5},
  {"name": "Imp Tab", "batch_no": "B1", "expiry_date": "2032-01-15", "qty": 3}
]', true)) -> 'errors' -> 0, '{"row": 2, "field": "batch_no", "message": "duplicate"}'::jsonb,
  'stock check run: the same batch twice in one file is caught before importing');
select is((public.import_opening_stock('[{"name": "Imp Tab", "hsn": "12ab", "batch_no": "B2", "expiry_date": "2032-01-01", "qty": 5}]', true))
  -> 'errors' -> 0 ->> 'field', 'hsn', 'a bad HSN code is reported by its column');

-- Leads: same number twice in one file; unknown executive
select pg_temp.login('14141414-0000-4000-a000-0000000000c1');
select is((public.import_leads('[
  {"name": "Imp Lead", "phone": "+919811100101"},
  {"name": "Imp Lead 2", "phone": "+919811100101"},
  {"name": "Imp Lead 3", "phone": "+919811100102", "assigned": "nobody-here"}
]', true)) -> 'errors', '[{"row": 2, "field": "phone", "message": "duplicate"}, {"row": 3, "field": "assigned", "message": "not_found"}]'::jsonb,
  'leads check run: number twice in the file, unknown executive');

-- Who may import
select pg_temp.login('14141414-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.import_patients('[]', true) $$, 'P0001', 'not_allowed', 'reception can''t import patients');
select throws_ok($$ select public.import_leads('[]', true) $$, 'P0001', 'not_allowed', 'or leads');

select * from finish();
rollback;
