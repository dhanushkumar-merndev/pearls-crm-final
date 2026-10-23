-- Phase 6: purchases → batches, the stock ledger, FEFO, selling from stock, alerts, opening stock.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(52);

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
  ('99999999-0000-4000-a000-00000000000a', 'p6-admin@staff.invalid'),
  ('99999999-0000-4000-a000-0000000000b1', 'p6-rec@staff.invalid'),
  ('99999999-0000-4000-a000-0000000000c1', 'p6-sales@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('99999999-0000-4000-a000-00000000000a', 'admin', 'P6 Admin', 'p6admin'),
  ('99999999-0000-4000-a000-0000000000b1', 'receptionist', 'P6 Rec', 'p6rec'),
  ('99999999-0000-4000-a000-0000000000c1', 'sales_executive', 'P6 Sales', 'p6sales');
insert into public.patients (id, uhid, full_name) values ('99999999-1111-4000-a000-000000000001', 'P6-1', 'P6 Patient');
insert into public.suppliers (id, name) values ('99999999-5555-4000-a000-000000000001', 'P6 Pharma Distributors');
insert into public.pharmacy_items (id, name, strength, form, manufacturer, hsn, gst_rate_bp, mrp_paise, selling_price_paise, reorder_level)
values ('99999999-6666-4000-a000-000000000001', 'P6 Cetirizine', '10 mg', 'Tablet', 'P6 Labs', '30049099', 1200, 1000, 1000, 20),
       ('99999999-6666-4000-a000-000000000002', 'P6 Sunscreen', '50 g', 'Cream', 'P6 Derma', '33049910', 1800, 69500, 69500, 0);
insert into public.number_series (series_key, fy, prefix, format, next_value)
values ('pharmacy_invoice', private.fy_label(now()), 'PH', '{prefix}/{fy}/{n}', 1)
on conflict (series_key, fy) do nothing;
update public.app_settings set value = value || '{"negative_stock": "block", "near_expiry_days": [90, 60, 30]}' where section = 'pharmacy';
create temp table d on commit drop as
  select (private.ist(now()))::date as today,
         private.month_end((private.ist(now()))::date + 400) as far,
         private.month_end((private.ist(now()))::date + 200) as near,
         (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash') as cash;
grant select on d to authenticated;

-- A pharmacy bill with the given [batch, qty] lines, saved (version 2).
create function pg_temp.sale(p_bill uuid, p_lines jsonb)
returns jsonb
language plpgsql
as $$
begin
  perform public.create_bill('pharmacy_invoice', '99999999-1111-4000-a000-000000000001', '{}', p_bill);
  return public.save_bill(p_bill, '{}', (
    select jsonb_agg(jsonb_build_object('kind', 'pharmacy', 'batch_id', l ->> 0, 'description', 'P6 medicine',
                                        'rate_paise', 1000, 'qty', (l ->> 1)::numeric, 'gst_rate_bp', 1200))
    from jsonb_array_elements(p_lines) l), 1);
end;
$$;
grant execute on function pg_temp.sale(uuid, jsonb) to authenticated;

select pg_temp.login('99999999-0000-4000-a000-0000000000b1');

------------------------------------------------------------------------------
-- Purchases → batches + movements
------------------------------------------------------------------------------
select lives_ok($$ select public.save_purchase(jsonb_build_object(
  'supplier_id', '99999999-5555-4000-a000-000000000001', 'invoice_no', 'inv-601', 'invoice_date', (select today from d),
  'items', jsonb_build_array(
    jsonb_build_object('item_id', '99999999-6666-4000-a000-000000000001', 'batch_no', 'far1', 'expiry_date', (select far from d) - 10,
                       'qty', 30, 'free_qty', 5, 'purchase_price_paise', 600, 'mrp_paise', 1000, 'gst_rate_bp', 1200),
    jsonb_build_object('item_id', '99999999-6666-4000-a000-000000000001', 'batch_no', 'NEAR1', 'expiry_date', (select near from d),
                       'qty', 10, 'purchase_price_paise', 650, 'mrp_paise', 1000, 'gst_rate_bp', 1200))),
  '99999999-7777-4000-a000-000000000001') $$, 'a purchase is saved as a draft');
select is((select (public.get_purchase('99999999-7777-4000-a000-000000000001')) ->> 'total_paise'), '27440',
  'purchase total = qty × price + GST: 30 × ₹6 + 12% = ₹201.60, 10 × ₹6.50 + 12% = ₹72.80 → ₹274.40 (free units cost nothing)');
select is((select (public.get_purchase('99999999-7777-4000-a000-000000000001')) -> 'items' -> 0 ->> 'expiry_date'),
  (select far::text from d), 'expiry is stored as the last day of its month');
select is((select count(*)::int from public.item_batches where item_id = '99999999-6666-4000-a000-000000000001'), 0,
  'nothing is in stock until the purchase is posted');
select lives_ok($$ select public.post_purchase('99999999-7777-4000-a000-000000000001', 1) $$, 'post the purchase');
select is((select qty_on_hand from public.item_batches where batch_no = 'FAR1' and item_id = '99999999-6666-4000-a000-000000000001'),
  35.000, 'bought 30 + 5 free = 35 on hand (batch numbers are upper-cased)');
select throws_ok($$ select public.post_purchase('99999999-7777-4000-a000-000000000001', 2) $$,
  'P0001', 'bill_locked', 'a posted purchase can''t be posted again');
select throws_ok($$ select public.save_purchase(jsonb_build_object(
  'supplier_id', '99999999-5555-4000-a000-000000000001', 'invoice_no', 'INV-601', 'invoice_date', (select today from d),
  'items', '[]'::jsonb), gen_random_uuid()) $$,
  'P0001', 'duplicate', 'the same supplier invoice can''t be entered twice');
select throws_ok($$ select public.save_purchase(jsonb_build_object(
  'supplier_id', '99999999-5555-4000-a000-000000000001', 'invoice_no', 'INV-602', 'invoice_date', (select today from d),
  'items', jsonb_build_array(jsonb_build_object('item_id', '99999999-6666-4000-a000-000000000001', 'batch_no', 'OLD',
    'expiry_date', (select today from d) - 40, 'qty', 1, 'purchase_price_paise', 1))), gen_random_uuid()) $$,
  'P0001', 'expired_batch', 'an expired batch can''t be bought in');

------------------------------------------------------------------------------
-- FEFO
------------------------------------------------------------------------------
create temp table b on commit drop as
  select (select id from public.item_batches where batch_no = 'FAR1') as far1,
         (select id from public.item_batches where batch_no = 'NEAR1') as near1;
grant select on b to authenticated;
select is((public.batches_for_sale('99999999-6666-4000-a000-000000000001')) -> 0 ->> 'batch_no', 'NEAR1',
  'FEFO: the batch that expires first is offered first');
select is((public.library_search('pharmacy_item', 'P6 Cetirizine')) -> 'items' -> 0 -> 'defaults' ->> 'on_hand',
  '45.000', 'the medicine picker shows 45 in stock');

------------------------------------------------------------------------------
-- Selling: finalize moves stock; the line keeps batch, expiry and cost
------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.sale('99999999-2222-4000-a000-000000000001',
  jsonb_build_array(jsonb_build_array((select near1 from b), 4), jsonb_build_array((select far1 from b), 2))) $$,
  'a pharmacy bill with two batches is saved');
select is((select jsonb_agg(jsonb_build_array(batch_no, expiry_date, unit_cost_paise, mfg, hsn_sac) order by line_no)
           from public.bill_items where bill_id = '99999999-2222-4000-a000-000000000001'),
  (select jsonb_build_array(jsonb_build_array('NEAR1', near, 650, 'P6 Labs', '30049099'),
                            jsonb_build_array('FAR1', far, 600, 'P6 Labs', '30049099')) from d),
  'the server copies batch no., expiry, unit cost, maker and HSN onto the lines');
select is((select qty_on_hand from public.item_batches where id = (select near1 from b)), 10.000, 'a draft moves no stock');
select lives_ok($$ select public.finalize_bill('99999999-2222-4000-a000-000000000001', 2) $$, 'finalize');
select is((select array[(select qty_on_hand from public.item_batches where id = (select near1 from b)),
                        (select qty_on_hand from public.item_batches where id = (select far1 from b))]),
  array[6.000, 33.000], 'finalizing takes 4 + 2 out of stock');

select lives_ok($$ select pg_temp.sale('99999999-2222-4000-a000-000000000002', jsonb_build_array(jsonb_build_array((select near1 from b), 7))) $$,
  'a bill for 7 from a batch with 6 left');
select throws_ok($$ select public.finalize_bill('99999999-2222-4000-a000-000000000002', 2) $$,
  'P0001', 'stock_insufficient', 'negative stock is blocked');
select is((select status::text from public.bills where id = '99999999-2222-4000-a000-000000000002'), 'draft', 'and the bill stays a draft');

select lives_ok($$ select public.create_bill('pharmacy_invoice', '99999999-1111-4000-a000-000000000001', '{}', '99999999-2222-4000-a000-000000000003') $$,
  'a bill with a medicine line that names no batch');
select lives_ok($$ select public.save_bill('99999999-2222-4000-a000-000000000003', '{}',
  '[{"kind": "pharmacy", "description": "Loose", "rate_paise": 100, "qty": 1}]', 1) $$, 'saved');
select throws_ok($$ select public.finalize_bill('99999999-2222-4000-a000-000000000003', 2) $$,
  'P0001', 'batch_required', 'a medicine line must say which batch it comes from');

------------------------------------------------------------------------------
-- Expired stock can't be sold
------------------------------------------------------------------------------
select pg_temp.login(null);
insert into public.item_batches (id, item_id, batch_no, expiry_date) values
  ('99999999-8888-4000-a000-000000000001', '99999999-6666-4000-a000-000000000002', 'EXP1',
   private.month_end((private.ist(now()))::date - 40));
insert into public.stock_movements (batch_id, kind, qty, ref_table) values ('99999999-8888-4000-a000-000000000001', 'opening', 5, 'import');
select pg_temp.login('99999999-0000-4000-a000-0000000000b1');
select is((public.batches_for_sale('99999999-6666-4000-a000-000000000002')) -> 0 ->> 'expired', 'true',
  'an expired batch is listed, flagged expired');
select lives_ok($$ select pg_temp.sale('99999999-2222-4000-a000-000000000004', '[["99999999-8888-4000-a000-000000000001", 1]]') $$,
  'a bill from the expired batch');
select throws_ok($$ select public.finalize_bill('99999999-2222-4000-a000-000000000004', 2) $$,
  'P0001', 'expired_batch', 'an expired batch can''t be sold');

------------------------------------------------------------------------------
-- Amend and cancel move stock back; old bills keep their GST
------------------------------------------------------------------------------
select pg_temp.login('99999999-0000-4000-a000-00000000000a');
update public.pharmacy_items set gst_rate_bp = 500 where id = '99999999-6666-4000-a000-000000000001';
select is((select array_agg(gst_rate_bp order by line_no) from public.bill_items where bill_id = '99999999-2222-4000-a000-000000000001'),
  array[1200, 1200], 'changing a medicine''s GST leaves finalized bills unchanged');
select lives_ok($$ select public.amend_bill('99999999-2222-4000-a000-000000000001',
  (select jsonb_agg(jsonb_build_object('kind', 'pharmacy', 'batch_id', batch_id, 'description', description, 'rate_paise', rate_paise,
                                       'qty', case when batch_no = 'NEAR1' then 1 else qty end, 'gst_rate_bp', gst_rate_bp) order by line_no)
     from public.bill_items where bill_id = '99999999-2222-4000-a000-000000000001'), 'patient returned 3 strips') $$,
  'amend: 4 → 1 from NEAR1');
select is((select qty_on_hand from public.item_batches where id = (select near1 from b)), 9.000, 'amending puts the 3 back');
select lives_ok($$ select public.cancel_bill('99999999-2222-4000-a000-000000000001', 'wrong patient') $$, 'cancel the bill');
select is((select array[(select qty_on_hand from public.item_batches where id = (select near1 from b)),
                        (select qty_on_hand from public.item_batches where id = (select far1 from b))]),
  array[10.000, 35.000], 'cancelling returns everything to stock');

------------------------------------------------------------------------------
-- Adjustments; the ledger is append-only; stock = sum of movements
------------------------------------------------------------------------------
select pg_temp.login('99999999-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.adjust_stock((select near1 from b), 'damaged', 2, '', gen_random_uuid()) $$,
  'P0001', 'reason_required', 'an adjustment needs a reason');
select lives_ok($$ select public.adjust_stock((select near1 from b), 'damaged', 2, 'strip torn', '99999999-9999-4000-a000-000000000001') $$,
  'write off 2 damaged');
select lives_ok($$ select public.adjust_stock((select near1 from b), 'damaged', 2, 'strip torn', '99999999-9999-4000-a000-000000000001') $$,
  'the same adjustment sent twice');
select is((select qty_on_hand from public.item_batches where id = (select near1 from b)), 8.000, 'is booked once');
select lives_ok($$ select public.adjust_stock((select far1 from b), 'count_correction', 33, 'monthly count', gen_random_uuid()) $$,
  'shelf count says 33');
select is((select qty from public.stock_movements where batch_id = (select far1 from b) order by id desc limit 1), -2.000,
  'the count books the difference (−2)');
select throws_ok($$ update public.stock_movements set qty = 1 $$, '42501', null, 'staff can''t edit the ledger');

select pg_temp.login(null);
select throws_ok($$ delete from public.stock_movements where batch_id = '99999999-8888-4000-a000-000000000001' $$,
  'P0001', 'not_allowed', 'even the database owner can''t delete ledger rows');
-- Random operations, then the cache must equal the ledger.
do $$
declare
  i integer;
begin
  for i in 1..40 loop
    insert into public.stock_movements (batch_id, kind, qty, ref_table)
    values (case when i % 2 = 0 then (select near1 from b) else (select far1 from b) end,
            case when i % 3 = 0 then 'purchase' else 'count_correction' end::public.stock_move_kind,
            case when i % 3 = 0 then (random() * 9 + 1)::int else (random() * 10 - 5)::int + 0.5 end, 'adjustments');
  end loop;
end $$;
select is_empty($$
  select b.id from public.item_batches b
  left join (select batch_id, sum(qty) as qty from public.stock_movements group by batch_id) m on m.batch_id = b.id
  where b.qty_on_hand <> coalesce(m.qty, 0) $$, 'after random operations, stock on hand = sum of movements for every batch');
select is(private.stock_cache_check(), 0, 'the nightly check finds nothing to fix');

------------------------------------------------------------------------------
-- Alerts fire once and clear after restock
------------------------------------------------------------------------------
-- Sunscreen: reorder level 10, nothing sellable (only the expired batch).
update public.pharmacy_items set reorder_level = 10 where id = '99999999-6666-4000-a000-000000000002';
select private.refresh_stock_alerts();
select private.refresh_stock_alerts();
select is((select count(*)::int from public.stock_alerts where item_id = '99999999-6666-4000-a000-000000000002'
           and alert = 'low' and cleared_at is null), 1, 'a low-stock alert fires once, however often it is checked');
select is((select count(*)::int from public.stock_alerts where batch_id = '99999999-8888-4000-a000-000000000001'
           and alert = 'expired' and cleared_at is null), 1, 'the expired batch has an alert');
select pg_temp.login('99999999-0000-4000-a000-0000000000b1');
select lives_ok($$ select public.save_purchase(jsonb_build_object(
  'supplier_id', '99999999-5555-4000-a000-000000000001', 'invoice_no', 'INV-603', 'invoice_date', (select today from d),
  'items', jsonb_build_array(jsonb_build_object('item_id', '99999999-6666-4000-a000-000000000002', 'batch_no', 'SUN1',
    'expiry_date', (select far from d), 'qty', 24, 'purchase_price_paise', 40000, 'mrp_paise', 69500, 'gst_rate_bp', 1800))),
  '99999999-7777-4000-a000-000000000003') $$, 'restock the sunscreen');
select lives_ok($$ select public.post_purchase('99999999-7777-4000-a000-000000000003', 1) $$, 'post it');
select is((select count(*)::int from public.stock_alerts where item_id = '99999999-6666-4000-a000-000000000002'
           and alert = 'low' and cleared_at is null), 0, 'restocking clears the low-stock alert');

------------------------------------------------------------------------------
-- Opening stock import; roles
------------------------------------------------------------------------------
select pg_temp.login('99999999-0000-4000-a000-00000000000a');
create temp table imp on commit drop as select '[
  {"name": "P6 Opening Syrup", "form": "Syrup", "gst_rate_bp": 1200, "mrp_paise": 12000, "batch_no": "os1", "expiry_date": "2031-05-01", "qty": 12},
  {"name": "P6 Opening Syrup", "form": "Syrup", "batch_no": "OS2", "expiry_date": "2031-08-01", "qty": 0}
]'::jsonb as rows;
grant select on imp to authenticated;
select is((public.import_opening_stock((select rows from imp), true)) -> 'errors' -> 0 ->> 'field', 'qty',
  'the check run finds the row with no quantity');
select is((select count(*)::int from public.pharmacy_items where name = 'P6 Opening Syrup'), 0, 'and saves nothing');
select is((public.import_opening_stock((select rows from imp) - 1, false)) ->> 'ok', '1', 'the good row imports');
select is((select qty_on_hand from public.item_batches b join public.pharmacy_items i on i.id = b.item_id
           where i.name = 'P6 Opening Syrup' and b.batch_no = 'OS1' and b.expiry_date = '2031-05-31'), 12.000,
  'item and batch created; expiry moved to the month end');
select is((public.import_opening_stock((select rows from imp) - 1, false)) -> 'errors' -> 0 ->> 'message', 'duplicate',
  'importing the same opening batch again is refused');

select pg_temp.login('99999999-0000-4000-a000-0000000000c1');
select is((select count(*)::int from public.item_batches), 0, 'sales staff can''t see stock');
select throws_ok($$ select public.stock_table() $$, 'P0001', 'not_allowed', 'nor open the stock table');

select * from finish();
rollback;
