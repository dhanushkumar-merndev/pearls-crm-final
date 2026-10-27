-- Phase 5: bills, the finalized lock, numbering, payments, advances, refunds, amend/cancel, KPIs.
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
  ('88888888-0000-4000-a000-00000000000a', 'p5-admin@staff.invalid'),
  ('88888888-0000-4000-a000-0000000000b1', 'p5-rec@staff.invalid'),
  ('88888888-0000-4000-a000-0000000000c1', 'p5-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('88888888-0000-4000-a000-00000000000a', 'admin', 'P5 Admin', 'p5admin'),
  ('88888888-0000-4000-a000-0000000000b1', 'receptionist', 'P5 Rec', 'p5rec'),
  ('88888888-0000-4000-a000-0000000000c1', 'sales_executive', 'P5 Sales', 'p5sales');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('88888888-1111-4000-a000-000000000001', 'P5-1', 'P5 Patient', '+919811100001');
-- Known numbering and a clinic profile for the frozen header (all rolled back).
delete from public.number_series where series_key in ('procedure_receipt', 'final_bill');
insert into public.number_series (series_key, fy, prefix, format, next_value)
values ('procedure_receipt', private.fy_label(now()), 'T', '{prefix}/{fy}/{n}', 964),
       ('final_bill', private.fy_label(now()), 'TF', '{prefix}/{fy}/{n}', 1);
insert into public.clinic_settings (branch_code, name) values ('main', 'P5 Clinic')
  on conflict (branch_code) do update set name = excluded.name;
update public.app_settings set value = value || '{"receptionist_max_discount_bp": 2000, "round_to_rupee": false}' where section = 'billing';
create temp table ids on commit drop as
  select (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash') as cash,
         (select id from public.lookup_values where kind = 'payment_mode' and code = 'upi') as upi,
         (select id from public.lookup_values where kind = 'bill_category' and code = 'procedure') as procedure,
         (select id from public.lookup_values where kind = 'bill_category' and code = 'pharmacy') as pharmacy;
grant select on ids to authenticated;
create temp table fy on commit drop as select right(private.fy_label(now()), 5) as short, private.ist(now())::date as today;
grant select on fy to authenticated;

------------------------------------------------------------------------------
-- Drafts: the server calculates; discount limit
------------------------------------------------------------------------------
select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
create temp table b1 on commit drop as
  select public.create_bill('procedure_receipt', '88888888-1111-4000-a000-000000000001', '{}', '88888888-2222-4000-a000-000000000001') as r;
select is((select r ->> 'status' from b1), 'draft', 'a new bill is a draft');
select is((select r ->> 'bill_no' from b1), null, 'drafts have no number');

create function pg_temp.items(p_discount_bp integer)
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('description', 'Hydrafacial', 'category_id', (select procedure from ids), 'rate_paise', 350000,
                       'qty', 1, 'discount_type', 'percent', 'discount_value', p_discount_bp, 'gst_rate_bp', 0,
                       'total_paise', 1, 'gross_paise', 999999),  -- client totals are ignored
    jsonb_build_object('description', 'Sunscreen', 'category_id', (select pharmacy from ids), 'rate_paise', 69500,
                       'qty', 2, 'discount_type', 'amount', 'discount_value', 0, 'gst_rate_bp', 1800));
$$;
grant execute on function pg_temp.items(integer) to authenticated;

select throws_ok($$ select public.save_bill('88888888-2222-4000-a000-000000000001', '{}', pg_temp.items(2500), 1) $$,
  'P0001', 'discount_limit', 'a receptionist can''t give 25% (limit 20%)');
select is(
  (public.save_bill('88888888-2222-4000-a000-000000000001', '{}', pg_temp.items(1000), 1)) ->> 'total_paise',
  '454000', '₹3,500 − 10% + 2 × ₹695 (GST inclusive) = ₹4,540.00, calculated on the server');
select is(
  (select jsonb_agg(i ->> 'gross_paise' order by (i ->> 'line_no')::int) from b1,
     jsonb_array_elements(public.get_bill('88888888-2222-4000-a000-000000000001') -> 'items') i),
  '["350000", "139000"]'::jsonb, 'line amounts come from rate × qty, not from what the screen sent');
select is((public.get_bill('88888888-2222-4000-a000-000000000001') -> 'items' -> 1 ->> 'cgst_paise'), '10601',
  'GST inside an inclusive price: ₹1,390 at 18% → CGST ₹106.01');
select throws_ok($$ select public.save_bill('88888888-2222-4000-a000-000000000001', '{}', pg_temp.items(1000), 1) $$,
  'P0001', 'stale_version', 'saving an old copy is refused');

------------------------------------------------------------------------------
-- Finalize: number, frozen header, payments
------------------------------------------------------------------------------
create temp table f1 on commit drop as
  select public.finalize_bill('88888888-2222-4000-a000-000000000001', 2,
    jsonb_build_array(jsonb_build_object('mode_id', (select cash from ids), 'amount_paise', 300000))) as r;
grant select on f1 to authenticated;
select is((select r ->> 'bill_no' from f1), (select 'T/' || short || '/964' from fy),
  'finalize takes the next number of the year');
select is((select r -> 'header_snapshot' ->> 'name' from f1), 'P5 Clinic', 'the clinic header is frozen into the bill');
select is((select r ->> 'received_paise' from f1), '300000', 'the cash paid at the desk is on the bill');
select throws_ok($$ select public.finalize_bill('88888888-2222-4000-a000-000000000001', 3) $$,
  'P0001', 'bill_locked', 'a bill is finalized once');

------------------------------------------------------------------------------
-- Finalized means locked — even for a direct database update
------------------------------------------------------------------------------
select throws_ok($$ select public.save_bill('88888888-2222-4000-a000-000000000001', '{}', '[]', 3) $$,
  'P0001', 'bill_locked', 'saving lines on a finalized bill is refused');
select pg_temp.login(null);
select throws_ok($$ update public.bills set total_paise = 1 where id = '88888888-2222-4000-a000-000000000001' $$,
  'P0001', 'bill_locked', 'even a direct UPDATE by the database owner is refused');
select throws_ok($$ update public.bill_items set rate_paise = 1 where bill_id = '88888888-2222-4000-a000-000000000001' $$,
  'P0001', 'bill_locked', 'and lines can''t be changed');
select throws_ok($$ delete from public.bills where id = '88888888-2222-4000-a000-000000000001' $$,
  'P0001', 'bill_locked', 'nor deleted');
select pg_temp.login('88888888-0000-4000-a000-0000000000b1');

------------------------------------------------------------------------------
-- Printing: original, then duplicate
------------------------------------------------------------------------------
select is((public.bill_print_data('88888888-2222-4000-a000-000000000001')) ->> 'copy', 'original', 'first print is the original');
select is((public.bill_print_data('88888888-2222-4000-a000-000000000001')) ->> 'copy', 'duplicate', 'reprints say duplicate copy');
select is((public.bill_print_data('88888888-2222-4000-a000-000000000001', false)) -> 'payments' -> 0 ->> 'mode', 'Cash',
  'payments print with their mode');

------------------------------------------------------------------------------
-- Payments, advances, refunds, balance
------------------------------------------------------------------------------
select throws_ok($$ select public.add_payment(jsonb_build_object('patient_id', '88888888-1111-4000-a000-000000000001',
  'mode_id', (select upi from ids), 'amount_paise', 200000,
  'allocations', jsonb_build_array(jsonb_build_object('bill_id', '88888888-2222-4000-a000-000000000001', 'amount_paise', 200000))),
  gen_random_uuid()) $$, 'P0001', 'over_allocated', 'paying more than the bill still owes is refused');
select lives_ok($$ select public.add_payment(jsonb_build_object('patient_id', '88888888-1111-4000-a000-000000000001',
  'mode_id', (select upi from ids), 'amount_paise', 154000, 'reference', 'UPI-123',
  'allocations', jsonb_build_array(jsonb_build_object('bill_id', '88888888-2222-4000-a000-000000000001', 'amount_paise', 154000))),
  '88888888-3333-4000-a000-000000000001') $$, 'the rest by UPI');
select is((public.patient_balance('88888888-1111-4000-a000-000000000001')) ->> 'balance_paise', '0', 'nothing left to pay');
select lives_ok($$ select public.add_payment(jsonb_build_object('patient_id', '88888888-1111-4000-a000-000000000001',
  'kind', 'advance', 'mode_id', (select cash from ids), 'amount_paise', 500000), '88888888-3333-4000-a000-000000000002') $$,
  'an advance for the next procedure');
select is((public.patient_balance('88888888-1111-4000-a000-000000000001')) ->> 'advance_paise', '500000', 'the advance is held');
select throws_ok($$ select public.add_payment(jsonb_build_object('patient_id', '88888888-1111-4000-a000-000000000001',
  'kind', 'refund', 'mode_id', (select cash from ids), 'amount_paise', 600000), gen_random_uuid()) $$,
  'P0001', 'over_allocated', 'a refund can''t be more than the advance');

-- Second bill paid from the advance.
create temp table b2 on commit drop as
  select public.create_bill('procedure_receipt', '88888888-1111-4000-a000-000000000001', '{}', '88888888-2222-4000-a000-000000000002') as r;
select lives_ok($$ select public.save_bill('88888888-2222-4000-a000-000000000002', '{}',
  jsonb_build_array(jsonb_build_object('description', 'Chemical peel', 'rate_paise', 250000, 'qty', 1)), 1) $$, 'second bill');
select is(
  (public.finalize_bill('88888888-2222-4000-a000-000000000002', 2, '[]', 250000)) ->> 'received_paise',
  '250000', 'paid from the advance at finalize');
select is((public.patient_balance('88888888-1111-4000-a000-000000000001')) ->> 'advance_paise', '250000', 'half the advance is left');
select is((public.get_bill('88888888-2222-4000-a000-000000000002')) ->> 'bill_no', (select 'T/' || short || '/965' from fy),
  'numbers follow on with no gaps');

------------------------------------------------------------------------------
-- Admin: cancel and amend
------------------------------------------------------------------------------
select throws_ok($$ select public.cancel_bill('88888888-2222-4000-a000-000000000002', 'mistake') $$,
  'P0001', 'not_allowed', 'reception can''t cancel a finalized bill');
select pg_temp.login('88888888-0000-4000-a000-00000000000a');
select throws_ok($$ select public.cancel_bill('88888888-2222-4000-a000-000000000002', '') $$,
  'P0001', 'reason_required', 'cancelling needs a reason');
select is((public.cancel_bill('88888888-2222-4000-a000-000000000002', 'patient changed mind')) ->> 'status', 'cancelled', 'admin cancels');
select is((public.get_bill('88888888-2222-4000-a000-000000000002')) ->> 'bill_no', (select 'T/' || short || '/965' from fy),
  'a cancelled bill keeps its number');
select is((public.patient_balance('88888888-1111-4000-a000-000000000001')) ->> 'advance_paise', '500000',
  'its payment goes back to the patient''s advance');
select is(
  (public.amend_bill('88888888-2222-4000-a000-000000000001',
     jsonb_build_array(jsonb_build_object('description', 'Hydrafacial', 'rate_paise', 454000, 'qty', 1)), 'wrong item billed')) ->> 'total_paise',
  '454000', 'admin amends a finalized bill');
select is((select count(*)::int from public.bill_versions where bill_id = '88888888-2222-4000-a000-000000000001'), 1,
  'the previous version is kept');
select is((public.get_bill('88888888-2222-4000-a000-000000000001')) ->> 'status', 'finalized', 'and it is still finalized');
select throws_ok($$ select public.amend_bill('88888888-2222-4000-a000-000000000001',
     jsonb_build_array(jsonb_build_object('description', 'Hydrafacial', 'rate_paise', 100000, 'qty', 1)), 'too low') $$,
  'P0001', 'over_allocated', 'an amend can''t go below what was already paid');

------------------------------------------------------------------------------
-- Final bill below the agreed price needs a reason
------------------------------------------------------------------------------
select pg_temp.login('88888888-0000-4000-a000-0000000000b1');
create temp table tr on commit drop as select public.start_treatment(
  '{"patient_id":"88888888-1111-4000-a000-000000000001","name":"P5 Package","agreed_price_paise":1000000}', gen_random_uuid()) as r;
grant select on tr to authenticated;
create temp table fb on commit drop as
  select public.create_bill('final_bill', '88888888-1111-4000-a000-000000000001',
    jsonb_build_object('treatment_id', (select r ->> 'id' from tr)), '88888888-2222-4000-a000-000000000003') as r;
select lives_ok($$ select public.save_bill('88888888-2222-4000-a000-000000000003', '{}',
  jsonb_build_array(jsonb_build_object('description', 'Package', 'rate_paise', 800000, 'qty', 1)), 1) $$, 'final bill lines');
select throws_ok($$ select public.finalize_bill('88888888-2222-4000-a000-000000000003', 2) $$,
  'P0001', 'below_agreed_price', 'billing below the agreed price needs a reason');
select is((public.finalize_bill('88888888-2222-4000-a000-000000000003', 2, '[]', 0, 'doctor approved discount')) ->> 'below_agreed_reason',
  'doctor approved discount', 'with a reason it finalizes');

------------------------------------------------------------------------------
-- KPIs: golden fixture + rollup = live
------------------------------------------------------------------------------
select pg_temp.login(null);
select is(
  (select jsonb_object_agg(k.metric, k.value) from private.kpi_compute_day((private.ist(now()))::date) k
    where k.dim_kind = 'clinic' and k.metric in ('collected_paise', 'refunds_paise')
      and k.metric is not null),
  -- Refunds counted the same way: staging may already have refunds today (browser tests make some).
  (select jsonb_build_object('collected_paise', s.c, 'refunds_paise', s.r) from (
     select coalesce(sum(amount_paise) filter (where kind <> 'refund'), 0) as c,
            coalesce(sum(amount_paise) filter (where kind = 'refund'), 0) as r
     from public.payments
     where cancelled_at is null and (private.ist(received_at))::date = (private.ist(now()))::date) s),
  'collected today = every non-cancelled payment and advance received today');
select ok(
  (select value from private.kpi_compute_day((private.ist(now()))::date) where metric = 'revenue_paise' and dim_kind = 'bill_type'
     and dim_id = 'procedure_receipt') >= 454000,
  'revenue by bill type includes the amended ₹4,540 bill (and not the cancelled one)');
select lives_ok($$ select private.kpi_rollup_day((private.ist(now()))::date) $$, 'roll up today');
select is_empty($$
  (select metric, dim_kind, dim_id, value from private.kpi_compute_day((private.ist(now()))::date) where value <> 0
   except select metric, dim_kind, dim_id, value from public.kpi_daily where day = (private.ist(now()))::date)
  union all
  (select metric, dim_kind, dim_id, value from public.kpi_daily where day = (private.ist(now()))::date
   except select metric, dim_kind, dim_id, value from private.kpi_compute_day((private.ist(now()))::date) where value <> 0)
$$, 'the stored rollup equals the live calculation');

select pg_temp.login('88888888-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.bills), 0, 'sales cannot read bills');

select * from finish();
rollback;
