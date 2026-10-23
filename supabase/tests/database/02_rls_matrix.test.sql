-- Guard rails for EVERY table and function, present and future (PLAN.md C7).
-- When a new phase adds tables, extend the expected lists below on purpose.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
$$, 'every public table has RLS switched on');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
$$, 'every public table has at least one policy');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
$$, 'anonymous visitors can touch no table');

-- Direct writes by signed-in users. Everything else must go through an RPC.
select is(
  (select string_agg(format('%s:%s', c.relname, p.priv), ', ' order by c.relname, p.priv)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p (priv)
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and has_table_privilege('authenticated', c.oid, p.priv)),
  -- Phase 1: admin master data (RLS lets only admins write; see 03_admin_libraries).
  'clinic_settings:UPDATE, doctor_leaves:DELETE, doctor_leaves:INSERT, doctor_leaves:UPDATE, '
  'doctor_schedules:DELETE, doctor_schedules:INSERT, doctor_schedules:UPDATE, doctors:INSERT, doctors:UPDATE, '
  'holidays:DELETE, holidays:INSERT, holidays:UPDATE, lookup_values:INSERT, lookup_values:UPDATE, '
  'pharmacy_items:INSERT, pharmacy_items:UPDATE, room_types:INSERT, room_types:UPDATE, services:INSERT, '
  'services:UPDATE, treatment_template_services:DELETE, treatment_template_services:INSERT, '
  'treatment_template_services:UPDATE, treatment_templates:INSERT, treatment_templates:UPDATE',
  'signed-in users write directly only where allowed');

select is_empty($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%')
$$, 'every security-definer function pins its search_path');

select is(
  (select string_agg(p.proname, ', ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'public_branding',
  'anonymous visitors can call only public_branding');

------------------------------------------------------------------------------
-- Who can read the admin-only system tables (one fixture row in each).
------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('33333333-0000-4000-a000-00000000000a', 'm-admin@test.local'),
  ('33333333-0000-4000-a000-0000000000b1', 'm-rec@test.local'),
  ('33333333-0000-4000-a000-0000000000c1', 'm-sales@test.local'),
  ('33333333-0000-4000-a000-0000000000c2', 'm-manager@test.local'),
  ('33333333-0000-4000-a000-0000000000d1', 'm-bdm@test.local');
insert into public.staff (id, role, full_name) values
  ('33333333-0000-4000-a000-00000000000a', 'admin', 'M Admin'),
  ('33333333-0000-4000-a000-0000000000b1', 'receptionist', 'M Rec'),
  ('33333333-0000-4000-a000-0000000000c1', 'sales_executive', 'M Sales'),
  ('33333333-0000-4000-a000-0000000000c2', 'sales_manager', 'M Manager'),
  ('33333333-0000-4000-a000-0000000000d1', 'bdm', 'M Bdm');
insert into public.number_series (series_key, fy, prefix) values ('final_bill', '2030-31', 'M')
  on conflict do nothing;
insert into public.client_errors (app, message) values ('web', 'fixture');
insert into public.integration_status (integration) values ('ors') on conflict do nothing;
insert into public.job_runs (job) values ('fixture');
insert into public.usage_counters (month, metric, value) values ('2030-01-01', 'fixture', 1);
insert into public.idempotency_keys (key, fn) values (gen_random_uuid(), 'fixture');

create temp table violations (finding text) on commit drop;

do $$
declare
  r record;
  t text;
  n bigint;
  found_rows text[] := '{}';
  admin_only text[] := array['audit_log', 'number_series', 'client_errors', 'integration_status',
                             'job_runs', 'usage_counters'];
begin
  for r in select * from (values
    ('33333333-0000-4000-a000-0000000000b1', 'receptionist'),
    ('33333333-0000-4000-a000-0000000000c1', 'sales_executive'),
    ('33333333-0000-4000-a000-0000000000c2', 'sales_manager'),
    ('33333333-0000-4000-a000-0000000000d1', 'bdm')) as x (id, who)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    foreach t in array admin_only || array['idempotency_keys'] loop
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        found_rows := found_rows || format('%s saw %s rows in %s', r.who, n, t);
      end if;
    end loop;
    execute 'reset role';
  end loop;
  insert into violations select unnest(found_rows);
end $$;

select is_empty($$ select * from violations $$,
  'non-admins see no rows in admin-only system tables');

select * from finish();
rollback;
