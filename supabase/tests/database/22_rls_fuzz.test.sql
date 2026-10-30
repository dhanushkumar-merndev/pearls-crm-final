-- RLS fuzzing (PLAN.md E3 row 15): every public table, as every non-admin role, plus a signed-in
-- account with no staff row and a deactivated one. Each tries to read, update every row and
-- delete every row of every table (rolled back), and the last two call every RPC with empty
-- arguments. The expected results are written out below; a new table or policy that lets more
-- through makes this fail. Staging holds real-looking test data, so "0 rows" means something.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);
insert into auth.users (id, email) values
  ('22222222-2200-4000-a000-000000000001', 'fz-nostaff@test.local'),
  ('22222222-2200-4000-a000-000000000002', 'fz-gone@test.local'),
  ('22222222-2200-4000-a000-0000000000b1', 'fz-rec@test.local'),
  ('22222222-2200-4000-a000-0000000000c1', 'fz-sales@test.local'),
  ('22222222-2200-4000-a000-0000000000c2', 'fz-mgr@test.local'),
  ('22222222-2200-4000-a000-0000000000d1', 'fz-bdm@test.local');
insert into public.staff (id, role, full_name, active, deactivated_at) values
  ('22222222-2200-4000-a000-000000000002', 'receptionist', 'Fz Gone', false, now()),
  ('22222222-2200-4000-a000-0000000000b1', 'receptionist', 'Fz Rec', true, null),
  ('22222222-2200-4000-a000-0000000000c1', 'sales_executive', 'Fz Sales', true, null),
  ('22222222-2200-4000-a000-0000000000c2', 'sales_manager', 'Fz Mgr', true, null),
  ('22222222-2200-4000-a000-0000000000d1', 'bdm', 'Fz Bdm', true, null);
-- At least one supplier, so reception's one allowed direct edit shows up on an empty database too (CI).
insert into public.suppliers (name) values ('Fz Supplier');
create temp table findings (who text, tbl text, op text, n bigint, err text);
grant all on findings to authenticated;
do $$
declare
  r record; t record; n bigint; col text;
begin
  for r in select * from (values ('22222222-2200-4000-a000-000000000001','nostaff'),('22222222-2200-4000-a000-000000000002','gone'),
     ('22222222-2200-4000-a000-0000000000b1','receptionist'),('22222222-2200-4000-a000-0000000000c1','sales_executive'),
     ('22222222-2200-4000-a000-0000000000c2','sales_manager'),('22222222-2200-4000-a000-0000000000d1','bdm')) x(id, who) loop
    for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind in ('r','p') order by 1 loop
      select a.attname into col from pg_attribute a where a.attrelid = format('public.%I', t.relname)::regclass and a.attnum > 0 and not a.attisdropped
        and a.attidentity = '' and a.attgenerated = '' order by a.attnum desc limit 1;
      perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        execute format('select count(*) from public.%I', t.relname) into n;
        if n > 0 then insert into findings values (r.who, t.relname, 'select', n, null); end if;
      exception when others then null; end;
      begin
        execute format('update public.%I set %I = %I', t.relname, col, col);
        get diagnostics n = row_count;
        if n > 0 then insert into findings values (r.who, t.relname, 'update', n, null); end if;
      exception when others then null; end;
      begin
        execute format('delete from public.%I', t.relname);
        get diagnostics n = row_count;
        if n > 0 then insert into findings values (r.who, t.relname, 'delete', n, null); end if;
      exception when others then null; end;
      execute 'reset role';
    end loop;
  end loop;
end $$;
create temp table rpc_ok (who text, fn text, err text);
grant all on rpc_ok to authenticated;
do $$
declare
  r record; f record; e text;
begin
  for r in select * from (values ('22222222-2200-4000-a000-000000000001','nostaff'),('22222222-2200-4000-a000-000000000002','gone')) x(id, who) loop
    for f in
      select p.proname, p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.prokind = 'f'
        and p.prorettype <> 'trigger'::regtype
    loop
      perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        execute format('select public.%I(%s)', f.proname, (select string_agg('null', ', ') from generate_series(1, f.pronargs)));
        insert into rpc_ok values (r.who, f.proname, null);
      exception when others then
        get stacked diagnostics e = message_text;
        if e not in ('not_signed_in', 'not_allowed', 'staff_inactive') then insert into rpc_ok values (r.who, f.proname, e); end if;
      end;
      execute 'reset role';
    end loop;
  end loop;
end $$;
-- Shared reference lists every staff member may read (pickers, settings, their own staff row).
create temp table shared_lists (tbl text primary key);
insert into shared_lists values ('app_settings'), ('clinic_settings'), ('doctor_schedules'), ('doctors'), ('holidays'),
  ('lookup_values'), ('offices'), ('pharmacy_items'), ('room_types'), ('services'), ('staff'), ('treatment_templates');

select is_empty($$ select tbl from findings where who = 'nostaff' $$,
  'a signed-in account with no staff row sees, changes and deletes nothing');
select results_eq($$ select tbl || ':' || op || ':' || n from findings where who = 'gone' $$, $$ values ('staff:select:1') $$,
  'a deactivated person sees only their own staff row');
select is_empty($$ select who || ' ' || tbl from findings where op = 'delete' $$, 'no role can delete rows directly from any table');
select results_eq($$ select who || ' ' || tbl from findings where op = 'update' order by 1 $$, $$ values ('receptionist suppliers') $$,
  'the only direct update outside admin is reception editing suppliers');
select is_empty($$ select who || ' ' || tbl from findings
                   where op = 'select' and who in ('bdm', 'sales_executive') and tbl not in (select tbl from shared_lists)
                     -- Sales executives send WhatsApp to their leads: they read the approved templates (wording only, no patient data).
                     and not (who = 'sales_executive' and tbl = 'wa_templates') $$,
  'BDMs and sales executives with nothing assigned see only the shared lists');
select is_empty($$ select who || ' ' || tbl from findings where op = 'select' and tbl = 'staff' and n > 1 and who in ('bdm', 'sales_executive', 'gone') $$,
  'and of the staff table only their own row');
select results_eq($$ select distinct fn from rpc_ok where err is null order by 1 $$, $$ values ('files_viewable'), ('public_branding') $$,
  'without an active staff login every RPC refuses, except the login page''s branding and file links (which follow RLS)');

select * from finish();
rollback;
