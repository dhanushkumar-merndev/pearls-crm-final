-- All bills page breakdown (bills_table.summary): billed / received / due for finalized bills, split by
-- bill type and payment mode; drafts and cancelled bills only counted; cancelled payments left out.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

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
  ('33333333-0000-4000-a000-0000000000b1', 'bb-rec@staff.invalid'),
  ('33333333-0000-4000-a000-0000000000c1', 'bb-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('33333333-0000-4000-a000-0000000000b1', 'receptionist', 'Breakdown Rec', 'bbrec'),
  ('33333333-0000-4000-a000-0000000000c1', 'sales_executive', 'Breakdown Sales', 'bbsales');
insert into public.patients (id, uhid, full_name, phone_e164) values
  ('33333333-1111-4000-a000-000000000001', 'BB-1', 'Breakdown Patient', '+919811433001');

-- Bills on a day no other test uses (one finalized of each type, a draft, a cancelled one).
-- Totals set directly: the bills have no lines, so nothing recomputes them.
insert into public.bills (id, bill_type, bill_no, status, patient_id, bill_at, total_paise, cancel_reason) values
  ('33333333-2222-4000-a000-000000000001', 'procedure_receipt', 'BB-R1', 'finalized', '33333333-1111-4000-a000-000000000001', '2031-03-03 06:00+00', 1000000, null),
  ('33333333-2222-4000-a000-000000000002', 'procedure_receipt', 'BB-R2', 'finalized', '33333333-1111-4000-a000-000000000001', '2031-03-03 07:00+00', 500000, null),
  ('33333333-2222-4000-a000-000000000003', 'pharmacy_invoice', 'BB-P1', 'finalized', '33333333-1111-4000-a000-000000000001', '2031-03-03 08:00+00', 120000, null),
  ('33333333-2222-4000-a000-000000000005', 'procedure_receipt', 'BB-R3', 'cancelled', '33333333-1111-4000-a000-000000000001', '2031-03-03 09:00+00', 999900, 'wrong patient');
insert into public.bills (id, bill_type, status, patient_id, created_at, total_paise) values
  ('33333333-2222-4000-a000-000000000004', 'pharmacy_invoice', 'draft', '33333333-1111-4000-a000-000000000001', '2031-03-03 10:00+00', 77700);

-- Payments: cash 6,000 + UPI 2,000 on R1; card 1,200 on P1; a cancelled cash 5,000 on R2 (not counted).
insert into public.payments (id, patient_id, mode_id, amount_paise, received_at, cancelled_at) values
  ('33333333-3333-4000-a000-000000000001', '33333333-1111-4000-a000-000000000001',
   (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash'), 600000, '2031-03-03 06:05+00', null),
  ('33333333-3333-4000-a000-000000000002', '33333333-1111-4000-a000-000000000001',
   (select id from public.lookup_values where kind = 'payment_mode' and code = 'upi'), 200000, '2031-03-03 06:06+00', null),
  ('33333333-3333-4000-a000-000000000003', '33333333-1111-4000-a000-000000000001',
   (select id from public.lookup_values where kind = 'payment_mode' and code = 'card'), 120000, '2031-03-03 08:05+00', null),
  ('33333333-3333-4000-a000-000000000004', '33333333-1111-4000-a000-000000000001',
   (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash'), 500000, '2031-03-03 07:05+00', null);
insert into public.payment_allocations (payment_id, bill_id, amount_paise) values
  ('33333333-3333-4000-a000-000000000001', '33333333-2222-4000-a000-000000000001', 600000),
  ('33333333-3333-4000-a000-000000000002', '33333333-2222-4000-a000-000000000001', 200000),
  ('33333333-3333-4000-a000-000000000003', '33333333-2222-4000-a000-000000000003', 120000),
  ('33333333-3333-4000-a000-000000000004', '33333333-2222-4000-a000-000000000002', 500000);
update public.payments set cancelled_at = '2031-03-03 07:30+00', cancel_reason = 'entered twice'
 where id = '33333333-3333-4000-a000-000000000004';

create temp table day on commit drop as select '{"from": "2031-03-03", "to": "2031-03-03"}'::jsonb as f;
grant select on day to authenticated;

select pg_temp.login('33333333-0000-4000-a000-0000000000b1');

select is((select public.bills_table(f) -> 'summary' -> 'billed_paise' from day), '1620000'::jsonb,
  'billed = the three finalized bills (draft and cancelled left out)');
select is((select public.bills_table(f) -> 'summary' -> 'received_paise' from day), '920000'::jsonb,
  'received = cash + UPI + card; the cancelled payment is not counted');
select is((select public.bills_table(f) -> 'summary' -> 'due_paise' from day), '700000'::jsonb,
  'due = billed − received');
select is((select (public.bills_table(f) -> 'summary' ->> 'billed_paise')::bigint from day),
          (select (public.bills_table(f) ->> 'sum_paise')::bigint from day),
  'billed matches the sum the page always showed');
select is((select public.bills_table(f) -> 'summary' -> 'by_type' from day),
  '[{"bill_type": "procedure_receipt", "count": 2, "billed_paise": 1500000, "received_paise": 800000},
    {"bill_type": "pharmacy_invoice", "count": 1, "billed_paise": 120000, "received_paise": 120000}]'::jsonb,
  'by bill type: count, billed and received each (a bill with only a cancelled payment still counts as billed)');
select is((select jsonb_path_query_array(public.bills_table(f) -> 'summary' -> 'by_mode', '$[*].received_paise') from day),
  '[600000, 200000, 120000]'::jsonb,
  'by mode: biggest first, the cancelled cash payment left out');
select is((select public.bills_table(f) -> 'summary' -> 'drafts' from day), '1'::jsonb, 'one draft counted');
select is((select public.bills_table(f) -> 'summary' -> 'cancelled' from day), '1'::jsonb, 'one cancelled bill counted');
select is((select public.bills_table(f || '{"bill_type": "pharmacy_invoice"}') -> 'summary' -> 'billed_paise' from day), '120000'::jsonb,
  'the breakdown follows the filters (pharmacy only)');

select pg_temp.login('33333333-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.bills_table('{"from": "2031-03-03", "to": "2031-03-03"}') $$, 'P0001', null,
  'a sales executive cannot see the bills breakdown');

select * from finish();
rollback;
