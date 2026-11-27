-- Reception manages doctors, services and treatments like the admin (owner, 25/11 and 27/11/2026);
-- nobody else new does.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

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
  ('44444444-0000-4000-b000-0000000000b1', 'rd-rec@staff.invalid'),
  ('44444444-0000-4000-b000-0000000000c1', 'rd-sales@staff.invalid'),
  ('44444444-0000-4000-b000-0000000000a1', 'rd-mgr@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('44444444-0000-4000-b000-0000000000b1', 'receptionist', 'RD Rec', 'rdrec'),
  ('44444444-0000-4000-b000-0000000000c1', 'sales_executive', 'RD Sales', 'rdsales'),
  ('44444444-0000-4000-b000-0000000000a1', 'sales_manager', 'RD Manager', 'rdmgr');
insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, status, owner_staff_id) values
  ('44444444-7777-4000-b000-000000000001', 'private', 'doctor_signature/rd/s.png', 'doctor_signature', 'image/png', 9000, 'uploaded',
   '44444444-0000-4000-b000-0000000000b1'),
  ('44444444-7777-4000-b000-000000000002', 'private', 'pdf/rd/x.pdf', 'pdf', 'application/pdf', 9000, 'uploaded',
   '44444444-0000-4000-b000-0000000000b1');

select ok((select 'receptionist' = any(roles) from private.file_rule('doctor_signature')), 'reception may upload a doctor''s signature');

------------------------------------------------------------------------------
-- Reception: doctors, hours, leave, services
------------------------------------------------------------------------------
select pg_temp.login('44444444-0000-4000-b000-0000000000b1');
select lives_ok($$ insert into public.doctors (id, full_name, specialization, slot_minutes)
                   values ('44444444-1111-4000-b000-000000000001', 'Dr RD One', 'Dermatology', 15) $$, 'reception adds a doctor');
select lives_ok($$ update public.doctors set specialization = 'Trichology', consultation_fee_paise = 50000
                   where id = '44444444-1111-4000-b000-000000000001' $$, 'reception edits the doctor');
select is((select specialization from public.doctors where id = '44444444-1111-4000-b000-000000000001'), 'Trichology', 'the change is saved');
select lives_ok($$ insert into public.doctor_schedules (id, doctor_id, weekday, start_time, end_time)
                   values ('44444444-2222-4000-b000-000000000001', '44444444-1111-4000-b000-000000000001', 1, '10:00', '13:00') $$,
  'reception sets weekly hours');
select lives_ok($$ insert into public.doctor_leaves (id, doctor_id, during, reason)
                   values ('44444444-3333-4000-b000-000000000001', '44444444-1111-4000-b000-000000000001',
                           tstzrange('2030-02-10 00:00+05:30', '2030-02-11 00:00+05:30'), 'conference') $$,
  'reception adds a leave');
delete from public.doctor_leaves where id = '44444444-3333-4000-b000-000000000001';
delete from public.doctor_schedules where id = '44444444-2222-4000-b000-000000000001';
select is((select count(*)::int from public.doctor_schedules where doctor_id = '44444444-1111-4000-b000-000000000001')
          + (select count(*)::int from public.doctor_leaves where doctor_id = '44444444-1111-4000-b000-000000000001'), 0,
  'reception removes hours and leave');
select lives_ok($$ insert into public.services (id, name, default_price_paise, gst_rate_bp)
                   values ('44444444-4444-4000-b000-000000000001', 'RD Laser session', 250000, 1800) $$, 'reception adds a service');
select lives_ok($$ update public.services set default_price_paise = 300000 where id = '44444444-4444-4000-b000-000000000001' $$,
  'reception changes its price');
select is((select default_price_paise from public.services where id = '44444444-4444-4000-b000-000000000001'), 300000::bigint, 'new price saved');

-- Signature: reception may upload one; it must be a signature file.
select lives_ok($$ update public.doctors set signature_file_id = '44444444-7777-4000-b000-000000000001'
                   where id = '44444444-1111-4000-b000-000000000001' $$, 'a signature upload is set on the doctor');
select throws_ok($$ update public.doctors set signature_file_id = '44444444-7777-4000-b000-000000000002'
                    where id = '44444444-1111-4000-b000-000000000001' $$, 'P0001', 'invalid_input', 'any other file is refused');

-- Treatments (sales quote from these) and the services inside a treatment.
select lives_ok($$ insert into public.treatment_templates (id, name, category, default_sessions, gap_days, pricing, default_price_paise)
                   values ('44444444-5555-4000-b000-000000000001', 'RD Hair plan', 'procedure', 6, '{0,30}', 'package', 6000000) $$,
  'reception adds a treatment');
select lives_ok($$ update public.treatment_templates set default_price_paise = 5500000, default_sessions = 8
                   where id = '44444444-5555-4000-b000-000000000001' $$, 'reception changes its sessions and price');
select is((select default_price_paise from public.treatment_templates where id = '44444444-5555-4000-b000-000000000001'),
  5500000::bigint, 'new treatment price saved');
select lives_ok($$ insert into public.treatment_template_services (id, template_id, service_id, qty)
                   values ('44444444-6666-4000-b000-000000000001', '44444444-5555-4000-b000-000000000001',
                           '44444444-4444-4000-b000-000000000001', 1) $$, 'reception puts a service in the treatment');
delete from public.treatment_template_services where id = '44444444-6666-4000-b000-000000000001';
select is((select count(*)::int from public.treatment_template_services where template_id = '44444444-5555-4000-b000-000000000001'), 0,
  'and takes it out again');

-- Still admin-only for reception: rooms and settings.
select throws_ok($$ insert into public.room_types (name, daily_rate_paise) values ('RD Room', 100) $$, '42501', null,
  'rooms stay admin-only');

------------------------------------------------------------------------------
-- Sales: still read-only
------------------------------------------------------------------------------
select pg_temp.login('44444444-0000-4000-b000-0000000000c1');
select throws_ok($$ insert into public.doctors (full_name) values ('Dr Sales') $$, '42501', null, 'sales cannot add doctors');
select throws_ok($$ insert into public.services (name, default_price_paise) values ('Sales svc', 1) $$, '42501', null, 'sales cannot add services');
select throws_ok($$ insert into public.treatment_templates (name, default_price_paise) values ('Sales plan', 1) $$, '42501', null,
  'sales cannot add treatments');
select pg_temp.login('44444444-0000-4000-b000-0000000000a1');
update public.services set default_price_paise = 1 where id = '44444444-4444-4000-b000-000000000001';
reset role;
select is((select default_price_paise from public.services where id = '44444444-4444-4000-b000-000000000001'), 300000::bigint,
  'a sales manager cannot change prices (nothing changes)');

select * from finish();
rollback;
