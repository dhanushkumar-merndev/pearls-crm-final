-- Quotations (treatments + total, sent from the salesperson's own WhatsApp) and moving the next
-- call without logging a call (owner, 20/11/2026).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

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
  ('42424242-0000-4000-a000-0000000000a1', 'q-mgr@staff.invalid'),
  ('42424242-0000-4000-a000-0000000000c1', 'q-s1@staff.invalid'),
  ('42424242-0000-4000-a000-0000000000c2', 'q-s2@staff.invalid'),
  ('42424242-0000-4000-a000-0000000000b1', 'q-rec@staff.invalid');
insert into public.staff (id, role, full_name, username) values
  ('42424242-0000-4000-a000-0000000000a1', 'sales_manager', 'Q Manager', 'qmgr'),
  ('42424242-0000-4000-a000-0000000000c1', 'sales_executive', 'Q Priya', 'qs1'),
  ('42424242-0000-4000-a000-0000000000c2', 'sales_executive', 'Q Other', 'qs2'),
  ('42424242-0000-4000-a000-0000000000b1', 'receptionist', 'Q Rec', 'qrec');
insert into public.treatment_templates (id, name, default_price_paise) values
  ('42424242-1111-4000-a000-000000000001', 'Q Hair transplant', 12000000);
insert into public.leads (id, name, phone_e164, assigned_to) values
  ('42424242-5555-4000-a000-000000000001', 'Asha Quote', '+919811442001', '42424242-0000-4000-a000-0000000000c1');

create function pg_temp.quote()
returns jsonb language sql as $$
  select jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('treatment_id', '42424242-1111-4000-a000-000000000001', 'name', 'Q Hair transplant', 'qty', 1, 'price_paise', 12000000),
      jsonb_build_object('name', 'PRP', 'qty', 3, 'price_paise', 500000)),
    'discount_paise', 1000000,
    'valid_until', to_char((now() at time zone 'Asia/Kolkata')::date + 10, 'YYYY-MM-DD'),
    'note', 'EMI available')
$$;
grant execute on function pg_temp.quote() to authenticated;

------------------------------------------------------------------------------
-- Money text
------------------------------------------------------------------------------
select is(private.inr(15000000), '₹1,50,000.00', 'lakh grouping');
select is(private.inr(12345678905), '₹12,34,56,789.05', 'crore grouping and paise');
select is(private.inr(99900), '₹999.00', 'under a thousand');
select is(private.inr(0), '₹0.00', 'zero');

------------------------------------------------------------------------------
-- Saving
------------------------------------------------------------------------------
select pg_temp.login('42424242-0000-4000-a000-0000000000b1');
select throws_ok($$ select public.save_lead_quotation('42424242-5555-4000-a000-000000000001', pg_temp.quote(),
                                                      '42424242-6666-4000-a000-000000000009') $$,
  'P0001', 'not_allowed', 'reception cannot make a sales quotation');
select pg_temp.login('42424242-0000-4000-a000-0000000000c2');
select throws_ok($$ select public.save_lead_quotation('42424242-5555-4000-a000-000000000001', pg_temp.quote(),
                                                      '42424242-6666-4000-a000-000000000009') $$,
  'P0001', 'not_allowed', 'another salesperson cannot quote someone else''s lead');

-- The quotation's own terms (Admin → Clinic profile → Terms → Quotation).
reset role;
update public.clinic_settings set terms = terms || '{"quotation": ["Q term one", "Q term two"]}'::jsonb;

select pg_temp.login('42424242-0000-4000-a000-0000000000c1');
create temp table q1 on commit drop as
  select public.save_lead_quotation('42424242-5555-4000-a000-000000000001', pg_temp.quote(), '42424242-6666-4000-a000-000000000001') as j;
grant select on q1 to authenticated;
select is(((select j from q1) ->> 'subtotal_paise')::bigint, 13500000::bigint, 'subtotal = 1 × ₹1,20,000 + 3 × ₹5,000');
select is(((select j from q1) ->> 'total_paise')::bigint, 12500000::bigint, 'total after the ₹10,000 discount');
select is(((select j from q1) ->> 'quote_no')::int, 1, 'first quotation of the lead');
select ok(((select j from q1) ->> 'message') like 'Hello Asha,%', 'the message greets the lead by first name');
select ok(((select j from q1) ->> 'message') like '%• PRP × 3 — ₹15,000.00%', 'each line with its amount');
select ok(((select j from q1) ->> 'message') like '%*Total — ₹1,25,000.00*%', 'the total in bold');
select ok(((select j from q1) ->> 'message') like '%Valid till %', 'valid till date');
select is((select j from q1) -> 'clinic' ->> 'name', (select name from public.clinic_settings order by branch_code = 'main' desc, created_at limit 1),
  'clinic details come from the settings');
select is((select j from q1) ->> 'lead_phone', '+919811442001', 'the lead''s number for WhatsApp');
select is((select j from q1) -> 'clinic' -> 'terms', '["Q term one", "Q term two"]'::jsonb, 'the quotation''s terms, in order');
select is((select j from q1) -> 'clinic' ->> 'gstin',
  (select gstin from public.clinic_settings order by branch_code = 'main' desc, created_at limit 1), 'GSTIN for the header');
select ok((select j from q1) -> 'clinic' ? 'signatory_label', 'the signatory line');

select is((public.save_lead_quotation('42424242-5555-4000-a000-000000000001', pg_temp.quote(), '42424242-6666-4000-a000-000000000001')
           ->> 'quote_no')::int, 1, 'the same client id again is the same quotation (no duplicate)');
select pg_temp.login(null);
select is((select amount_quoted_paise from public.leads where id = '42424242-5555-4000-a000-000000000001'), 12500000::bigint,
  'the lead''s Quoted amount is the total');
select is((select count(*)::int from public.lead_activities where lead_id = '42424242-5555-4000-a000-000000000001' and kind = 'quotation'), 1,
  'logged on the lead''s history');

select pg_temp.login('42424242-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.save_lead_quotation('42424242-5555-4000-a000-000000000001',
                      pg_temp.quote() || '{"discount_paise": 99999999}', '42424242-6666-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'a discount bigger than the subtotal is refused');
select throws_ok($$ select public.save_lead_quotation('42424242-5555-4000-a000-000000000001',
                      '{"items": []}', '42424242-6666-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'a quotation needs at least one line');
select throws_ok($$ select public.save_lead_quotation('42424242-5555-4000-a000-000000000001',
                      pg_temp.quote() || '{"valid_until": "2020-01-01"}', '42424242-6666-4000-a000-000000000002') $$,
  'P0001', 'invalid_input', 'valid till cannot be in the past');

------------------------------------------------------------------------------
-- Reading and sending
------------------------------------------------------------------------------
select is(jsonb_array_length(public.lead_quotations_list('42424242-5555-4000-a000-000000000001')), 1, 'the owner lists the lead''s quotations');
select public.mark_quotation_sent('42424242-6666-4000-a000-000000000001', 'whatsapp_pdf');
select is((public.lead_quotation('42424242-6666-4000-a000-000000000001') ->> 'sent_count')::int, 1, 'sharing counts as sent');

select pg_temp.login('42424242-0000-4000-a000-0000000000c2');
select is((select count(*)::int from public.lead_quotations), 0, 'another salesperson sees none of them');

select pg_temp.login('42424242-0000-4000-a000-0000000000a1');
select is((select count(*)::int from public.lead_quotations where lead_id = '42424242-5555-4000-a000-000000000001'), 1, 'the manager sees them');

------------------------------------------------------------------------------
-- Moving the next call without a call
------------------------------------------------------------------------------
select pg_temp.login('42424242-0000-4000-a000-0000000000c1');
select public.set_lead_next_call('42424242-5555-4000-a000-000000000001', date_trunc('minute', now()) + interval '2 days');
select public.set_lead_next_call('42424242-5555-4000-a000-000000000001', date_trunc('minute', now()) + interval '3 days');
select pg_temp.login(null);
select is((select count(*)::int from public.followups
           where ref_table = 'leads' and ref_id = '42424242-5555-4000-a000-000000000001' and status = 'open'), 1,
  'moved twice: still one open follow-up, at the new time');
select pg_temp.login('42424242-0000-4000-a000-0000000000c1');
select throws_ok($$ select public.set_lead_next_call('42424242-5555-4000-a000-000000000001', now() - interval '1 hour') $$,
  'P0001', 'followup_in_past', 'not into the past');
-- Chosen offline an hour ago for 30 minutes after that: still accepted when it arrives late.
select lives_ok($$ select public.set_lead_next_call('42424242-5555-4000-a000-000000000001',
                    now() - interval '30 minutes', now() - interval '1 hour') $$,
  'a phone that chose it offline earlier is judged by when it was chosen');

select * from finish();
rollback;
