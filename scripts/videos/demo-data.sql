-- Demo data for the explainer videos. LOCAL DATABASE ONLY, every person and number is made up.
-- Run after `pnpm db:reset` (which loads seed/01_users + 02_demo_settings):
--   docker exec -i supabase_db_pearl-crm psql -U postgres -v ON_ERROR_STOP=1 -q < scripts/videos/demo-data.sql
-- Business records go through the same RPCs the app calls (logged in as the right role), then a
-- few timestamps are moved into the past so lists, dashboards and reports have history.
\set ON_ERROR_STOP on
begin;

create function pg_temp.login(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  if p_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
end $$;
grant execute on function pg_temp.login(uuid) to authenticated;

-- Fixed people (seed/01_users): admin, reception, manager, sales, bdm.
create temp table who on commit drop as select
  '00000000-0000-4000-a000-000000000001'::uuid as admin,
  '00000000-0000-4000-a000-000000000002'::uuid as rec,
  '00000000-0000-4000-a000-000000000003'::uuid as mgr,
  '00000000-0000-4000-a000-000000000004'::uuid as sales,
  '00000000-0000-4000-a000-000000000005'::uuid as bdm,
  '00000000-0000-4000-a000-000000000009'::uuid as sales2;
grant select on who to authenticated;

------------------------------------------------------------------------------
-- Master data (admin pages write these tables directly too)
------------------------------------------------------------------------------
-- A second sales executive so the team views have more than one person.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-000000000009', 'authenticated', 'authenticated',
  'neha@staff.invalid', extensions.crypt('Pearl@2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-a000-000000000009', '00000000-0000-4000-a000-000000000009',
  jsonb_build_object('sub', '00000000-0000-4000-a000-000000000009', 'email', 'neha@staff.invalid', 'email_verified', true),
  'email', now(), now(), now());
insert into public.staff (id, role, full_name, username, phone_e164)
values ('00000000-0000-4000-a000-000000000009', 'sales_executive', 'Neha Kapoor', 'neha', '+919000000009');

update public.doctors set full_name = 'Dr Priya Rao', display_name = 'Dr Priya Rao', specialization = 'Dermatologist & cosmetologist'
 where id = '00000000-0000-4000-b000-000000000001';
update public.doctors set full_name = 'Dr Arjun Shetty', display_name = 'Dr Arjun Shetty', specialization = 'Plastic & cosmetic surgeon'
 where id = '00000000-0000-4000-b000-000000000002';
insert into public.doctors (id, full_name, display_name, specialization, consultation_fee_paise, colour_slot, sort)
values ('00000000-0000-4000-b000-000000000003', 'Dr Kavya Menon', 'Dr Kavya Menon', 'Trichologist (hair & scalp)', 50000, 3, 3);
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, valid_from)
select '00000000-0000-4000-b000-000000000003', d, s, e, '2000-01-01'
from generate_series(1, 6) d, (values ('10:00'::time, '13:00'::time), ('14:00', '18:00')) t (s, e);

update public.pharmacy_items set name = replace(name, 'Demo ', '');
insert into public.pharmacy_items (name, form, strength, manufacturer, hsn, gst_rate_bp, mrp_paise, selling_price_paise, purchase_price_paise, pack_size, sell_unit, reorder_level, rack)
values
  ('Minoxidil 5% solution', 'Solution', '60 ml', 'Dr Reddy''s', '3004', 1200, 89000, 89000, 61000, 1, 'bottle', 6, 'A1'),
  ('Biotin 10 mg', 'Tablet', '10 mg', 'Sun Pharma', '2936', 1200, 2400, 2400, 1500, 10, 'tablet', 60, 'A2'),
  ('Tranexamic acid cream', 'Cream', '30 g', 'Glenmark', '3004', 1200, 54000, 54000, 36000, 1, 'tube', 5, 'B1'),
  ('Mupirocin 2% ointment', 'Ointment', '5 g', 'GSK', '3004', 1200, 16500, 16500, 11000, 1, 'tube', 8, 'B2'),
  ('Cetirizine 10 mg', 'Tablet', '10 mg', 'Cipla', '3004', 1200, 200, 200, 110, 10, 'tablet', 100, 'C1'),
  ('Vitamin C serum', 'Serum', '30 ml', 'Pearl Derma', '3304', 1800, 120000, 120000, 78000, 1, 'bottle', 4, 'B3'),
  ('Ceramide moisturiser', 'Cream', '100 g', 'Cetaphil', '3304', 1800, 99000, 99000, 66000, 1, 'tube', 5, 'B4'),
  ('Azithromycin 500 mg', 'Tablet', '500 mg', 'Alkem', '3004', 1200, 2400, 2400, 1400, 3, 'tablet', 30, 'C2');

insert into public.suppliers (id, name, gstin, phone, contact_name, address) values
  ('00000000-0000-4000-c000-000000000001', 'Medline Pharma Distributors', '29ABCDE1234F1Z5', '+919000011001', 'Ravi Kumar', 'Chickpet, Bengaluru'),
  ('00000000-0000-4000-c000-000000000002', 'Sri Sai Medical Agencies', '29PQRSX6789K1Z2', '+919000011002', 'Lakshmi N', 'Jayanagar 4th Block, Bengaluru');

insert into public.services (name, category_id, default_price_paise, sac, gst_rate_bp)
select n, (select id from public.lookup_values where kind = 'bill_category' and code = c), p, '999312', 0
from (values ('Botox (per area)', 'procedure', 1200000), ('Microneedling with PRP', 'procedure', 800000),
             ('Rhinoplasty surgery', 'surgeon', 12000000), ('Hair transplant (FUE)', 'procedure', 9000000),
             ('Dressing', 'ip_services', 50000), ('Anaesthetist charges', 'ip_services', 1500000)) v (n, c, p);

insert into public.offices (id, name, lat, lng, radius_m) values
  ('00000000-0000-4000-d000-000000000001', 'Pearl Clinic, Jayanagar', 12.92990, 77.58260, 250);
update public.staff set office_id = '00000000-0000-4000-d000-000000000001'
 where id in ('00000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000008',
              '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000009');
update public.app_settings set value = value || '{"targets_enabled": true}' where section = 'sales';
-- Local file storage for scans (scripts/videos/functions-env.sh points files-sign here).
insert into storage.buckets (id, name, public) values ('pearl-files', 'pearl-files', false) on conflict do nothing;

-- A tidy (made-up) clinic profile for the letterhead on printed bills.
update public.clinic_settings set name = 'Pearl Aesthetic Clinic', legal_name = 'Pearl Aesthetics LLP',
  gstin = '29AAAAA0000A1Z5', llpin = 'AAA-0000', address_lines = array['No. 12, 4th Main Road, Jayanagar 4th Block'],
  city = 'Bengaluru', state = 'Karnataka', state_code = '29', pincode = '560011',
  phones = array['+91 90000 00000'], email = 'care@pearlclinic.example', website = 'www.pearlclinic.example',
  terms = jsonb_build_object(
    'procedure_receipt', jsonb_build_array('Fees once paid are not refundable.', 'Package sessions are valid for 12 months from the first session.',
      'Please follow the after-care advice given by the doctor.', 'Reschedule at least 24 hours before your appointment.'),
    'pharmacy_invoice', jsonb_build_array('Medicines once sold are not taken back, except unopened strips within 7 days with this bill.',
      'Store as directed on the pack. Keep out of reach of children.'),
    'final_bill', jsonb_build_array('This bill includes all charges for the in-patient stay listed above.',
      'Insurance claims: please collect the discharge summary and this bill from reception.',
      'Fees once paid are not refundable.'));
-- Numbers that read like a clinic's own: UHID PC1001, receipts R/2026-27/1, pharmacy PH/…, final bills FB/….
update public.number_series set prefix = case series_key when 'uhid' then 'PC' when 'procedure_receipt' then 'R'
  when 'pharmacy_invoice' then 'PH' when 'final_bill' then 'FB' when 'ip_number' then 'IP' else prefix end;
insert into public.number_series (series_key, fy, prefix, format, padding)
select 'ip_number', fy, 'IP', format, padding from public.number_series where series_key = 'final_bill'
on conflict do nothing;

------------------------------------------------------------------------------
-- Patients (reception registers them)
------------------------------------------------------------------------------
create temp table pt (n int primary key, id uuid, full_name text, gender text, age int, area text, phone text) on commit drop;
grant all on pt to authenticated;
insert into pt (n, full_name, gender, age, area)
select row_number() over (), v.* from (values
  ('Ananya Iyer', 'female', 29, 'Jayanagar'), ('Rahul Verma', 'male', 34, 'Koramangala'), ('Sneha Reddy', 'female', 41, 'JP Nagar'),
  ('Vikram Nair', 'male', 27, 'BTM Layout'), ('Meera Krishnan', 'female', 36, 'Basavanagudi'), ('Arjun Patil', 'male', 45, 'HSR Layout'),
  ('Divya Hegde', 'female', 31, 'Banashankari'), ('Karthik Rao', 'male', 38, 'Indiranagar'), ('Pooja Sharma', 'female', 24, 'Whitefield'),
  ('Suresh Gowda', 'male', 52, 'Rajajinagar'), ('Lakshmi Prasad', 'female', 47, 'Malleshwaram'), ('Nikhil Joshi', 'male', 30, 'Electronic City'),
  ('Kavitha Shenoy', 'female', 33, 'Jayanagar'), ('Rohan Desai', 'male', 26, 'Marathahalli'), ('Shalini Menon', 'female', 39, 'Bellandur'),
  ('Aditya Kulkarni', 'male', 29, 'Hebbal'), ('Priyanka Das', 'female', 28, 'Yelahanka'), ('Manjunath B', 'male', 44, 'Vijayanagar'),
  ('Ritu Agarwal', 'female', 35, 'Sadashivanagar'), ('Farhan Khan', 'male', 32, 'Frazer Town'), ('Deepa Ramesh', 'female', 42, 'Jayanagar'),
  ('Sanjay Mehta', 'male', 50, 'Koramangala'), ('Neha Bhat', 'female', 27, 'JP Nagar'), ('Akash Pillai', 'male', 23, 'BTM Layout'),
  ('Swathi Murthy', 'female', 30, 'Banashankari'), ('Harish Kumar', 'male', 37, 'Kanakapura Road'), ('Anjali Singh', 'female', 26, 'HSR Layout'),
  ('Prakash Naik', 'male', 48, 'Basavanagudi'), ('Bhavana Rao', 'female', 32, 'Wilson Garden'), ('Gautam Sen', 'male', 41, 'Domlur')
) v;
update pt set phone = '+9190001' || lpad((10000 + n)::text, 5, '0');

select pg_temp.login((select rec from who));
do $$
declare r record; v jsonb;
begin
  for r in select * from pt order by n loop
    v := public.register_patient(jsonb_build_object(
      'full_name', r.full_name, 'phone_e164', r.phone, 'gender', r.gender, 'age_years', r.age,
      'area', r.area, 'city', 'Bengaluru', 'preferred_language', 'English',
      'consents', jsonb_build_object('treatment', jsonb_build_object('given', true, 'method', 'paper'))),
      'new', p_client_id => ('11111111-0000-4000-a000-' || lpad(r.n::text, 12, '0'))::uuid);
    update pt set id = (v ->> 'patient_id')::uuid where n = r.n;
  end loop;
end $$;
select pg_temp.login(null);
-- Registered over the last two months (oldest first).
update public.patients p set created_at = now() - make_interval(days => 62 - pt.n * 2, hours => pt.n % 7)
from pt where p.id = pt.id;

------------------------------------------------------------------------------
-- Pharmacy stock: two supplier invoices posted three weeks ago (one batch expires soon, one item runs low)
------------------------------------------------------------------------------
select pg_temp.login((select rec from who));
do $$
declare v_items jsonb; v_p jsonb;
begin
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'batch_no', 'B' || upper(left(md5(i.name), 5)),
           'expiry_date', (current_date + case when i.name like 'Cetirizine%' then 40 else 420 end),
           'qty', case when i.name like 'Biotin%' then 40 when i.name like 'Minoxidil%' then 4 else 30 end,
           'free_qty', case when i.name like 'Paracetamol%' then 10 else 0 end,
           'purchase_price_paise', i.purchase_price_paise, 'mrp_paise', i.mrp_paise, 'gst_rate_bp', i.gst_rate_bp) order by i.name)
    into v_items
  from public.pharmacy_items i where i.purchase_price_paise is not null;
  v_p := public.save_purchase(jsonb_build_object('supplier_id', '00000000-0000-4000-c000-000000000001', 'invoice_no', 'MPD-4471',
           'invoice_date', current_date - 21, 'items', v_items), '22222222-0000-4000-a000-000000000001');
  perform public.post_purchase('22222222-0000-4000-a000-000000000001', 1);
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'batch_no', 'S' || upper(left(md5(i.name || 's'), 5)),
           'expiry_date', current_date + 540, 'qty', 20, 'purchase_price_paise', i.purchase_price_paise,
           'mrp_paise', i.mrp_paise, 'gst_rate_bp', i.gst_rate_bp))
    into v_items
  from public.pharmacy_items i where i.name in ('Sunscreen SPF 50', 'Ceramide moisturiser', 'Vitamin C serum');
  perform public.save_purchase(jsonb_build_object('supplier_id', '00000000-0000-4000-c000-000000000002', 'invoice_no', 'SSM/2210',
           'invoice_date', current_date - 9, 'items', v_items), '22222222-0000-4000-a000-000000000002');
  perform public.post_purchase('22222222-0000-4000-a000-000000000002', 1);
end $$;
select pg_temp.login(null);
-- Items with no purchase price in the seed get opening stock (sunscreen, paracetamol, amoxicillin).

------------------------------------------------------------------------------
-- Appointments: history (done), today's board (all states), the coming days (to confirm)
------------------------------------------------------------------------------
create temp table ap (n int, patient int, doctor int, at timestamptz, type text, status text, id uuid) on commit drop;
grant all on ap to authenticated;
insert into ap (n, patient, doctor, at, type, status)
select row_number() over (), v.patient, v.doctor, ((now() at time zone 'Asia/Kolkata')::date + v.day + v.t) at time zone 'Asia/Kolkata', v.type, v.status
from (values
  -- past weeks
  (1, 1, -20, time '11:00', 'consultation', 'done'), (2, 2, -18, '15:30', 'consultation', 'done'),
  (3, 1, -15, '12:00', 'procedure', 'done'), (5, 3, -12, '10:30', 'consultation', 'done'),
  (6, 2, -10, '16:00', 'consultation', 'done'), (7, 1, -8, '11:30', 'procedure', 'done'),
  (8, 3, -6, '14:30', 'consultation', 'no_show'), (9, 1, -4, '10:15', 'procedure', 'done'),
  (10, 2, -3, '17:00', 'consultation', 'done'), (11, 1, -2, '12:30', 'procedure', 'done'),
  (12, 3, -1, '15:00', 'consultation', 'done'), (13, 1, -1, '16:30', 'procedure', 'done'),
  -- today
  (14, 1, 0, '10:00', 'consultation', 'done'), (15, 2, 0, '10:30', 'consultation', 'done'),
  (16, 3, 0, '11:00', 'consultation', 'with_doctor'), (17, 1, 0, '11:30', 'procedure', 'arrived'),
  (18, 2, 0, '12:00', 'consultation', 'arrived'), (19, 1, 0, '14:00', 'procedure', 'confirmed'),
  (20, 3, 0, '14:30', 'consultation', 'confirmed'), (21, 2, 0, '15:00', 'consultation', 'pending_confirmation'),
  (22, 1, 0, '16:00', 'consultation', 'pending_confirmation'), (23, 3, 0, '17:00', 'follow_up', 'confirmed'),
  -- coming days
  (24, 1, 1, '10:30', 'consultation', 'pending_confirmation'), (25, 2, 1, '12:00', 'consultation', 'pending_confirmation'),
  (26, 3, 1, '15:30', 'procedure', 'confirmed'), (27, 1, 2, '11:00', 'consultation', 'pending_confirmation'),
  (28, 2, 3, '14:00', 'consultation', 'pending_confirmation'), (29, 3, 4, '10:00', 'consultation', 'pending_confirmation')
) v (patient, doctor, day, t, type, status);

-- Future slots are booked like the desk does; slots already gone (the booking RPC refuses the past)
-- are written as history.
insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, type, status,
  confirmed_via, confirmed_at, confirmed_by, booked_by, booked_from, arrived_at, with_doctor_at, done_at, created_at)
select ('33333333-0000-4000-a000-' || lpad(ap.n::text, 12, '0'))::uuid, pt.id, ('00000000-0000-4000-b000-00000000000' || ap.doctor)::uuid,
  (ap.at at time zone 'Asia/Kolkata')::date, ap.at, ap.at + interval '15 minutes', ap.type::public.appt_type, ap.status::public.appt_status,
  'reception', ap.at - interval '1 day', (select rec from who), (select rec from who), 'web',
  case when ap.status in ('arrived', 'with_doctor', 'done') then ap.at - interval '10 minutes' end,
  case when ap.status in ('with_doctor', 'done') then ap.at + interval '5 minutes' end,
  case when ap.status = 'done' then ap.at + interval '25 minutes' end,
  ap.at - interval '3 days'
from ap join pt on pt.n = ap.patient where ap.at <= now();
update ap set id = ('33333333-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid where at <= now();

select pg_temp.login((select rec from who));
do $$
declare r record;
begin
  for r in select ap.*, pt.id as pid from ap join pt on pt.n = ap.patient where ap.at > now() order by ap.n loop
    perform public.book_appointment(jsonb_build_object('patient_id', r.pid,
           'doctor_id', ('00000000-0000-4000-b000-00000000000' || r.doctor)::uuid, 'slot_start', r.at, 'type', r.type,
           'booked_from', 'web', 'confirm', r.status <> 'pending_confirmation'),
         ('33333333-0000-4000-a000-' || lpad(r.n::text, 12, '0'))::uuid);
    update ap set id = ('33333333-0000-4000-a000-' || lpad(r.n::text, 12, '0'))::uuid where n = r.n;
  end loop;
end $$;
select pg_temp.login(null);

------------------------------------------------------------------------------
-- Bills for the visits already done: consultation / procedure receipts and some pharmacy invoices.
-- Most are paid in full (cash, UPI, card); a few still have a balance.
------------------------------------------------------------------------------
create temp table mode on commit drop as
  select (select id from public.lookup_values where kind = 'payment_mode' and code = 'cash') as cash,
         (select id from public.lookup_values where kind = 'payment_mode' and code = 'upi') as upi,
         (select id from public.lookup_values where kind = 'payment_mode' and code = 'card') as card;
grant select on mode to authenticated;

create function pg_temp.service_line(p_name text, p_qty int default 1)
returns jsonb language sql as $$
  select jsonb_build_object('kind', 'service', 'service_id', s.id, 'description', s.name, 'category_id', s.category_id,
                            'rate_paise', s.default_price_paise, 'qty', p_qty, 'discount_type', 'amount', 'discount_value', 0,
                            'gst_rate_bp', s.gst_rate_bp)
  from public.services s where s.name = p_name
$$;
grant execute on function pg_temp.service_line(text, int) to authenticated;
create function pg_temp.med_line(p_name text, p_qty int)
returns jsonb language sql as $$
  select jsonb_build_object('kind', 'pharmacy', 'pharmacy_item_id', i.id, 'batch_id', b.id, 'description', i.name,
                            'category_id', (select id from public.lookup_values where kind = 'bill_category' and code = 'pharmacy'),
                            'rate_paise', coalesce(b.selling_price_paise, b.mrp_paise), 'qty', p_qty,
                            'discount_type', 'amount', 'discount_value', 0, 'gst_rate_bp', i.gst_rate_bp, 'hsn_sac', i.hsn,
                            'batch_no', b.batch_no, 'expiry_date', b.expiry_date, 'mfg', i.manufacturer)
  from public.pharmacy_items i
  join lateral (select * from public.item_batches where item_id = i.id and qty_on_hand >= p_qty order by expiry_date limit 1) b on true
  where i.name = p_name
$$;
grant execute on function pg_temp.med_line(text, int) to authenticated;

-- One bill: create → lines → finalize with payments, then dated to when it happened.
create function pg_temp.bill(p_n int, p_type text, p_patient uuid, p_links jsonb, p_items jsonb, p_pay jsonb, p_at timestamptz)
returns uuid language plpgsql as $$
declare v_id uuid := ('44444444-0000-4000-a000-' || lpad(p_n::text, 12, '0'))::uuid; v jsonb;
begin
  perform public.create_bill(p_type::public.bill_type, p_patient, p_links, v_id);
  v := public.save_bill(v_id, '{}', p_items, 1);
  perform public.finalize_bill(v_id, (v ->> 'version')::int, p_pay);
  return v_id;
end $$;
grant execute on function pg_temp.bill(int, text, uuid, jsonb, jsonb, jsonb, timestamptz) to authenticated;

create temp table bl (n int, appt int, type text, items jsonb, pay jsonb) on commit drop;
grant all on bl to authenticated;

select pg_temp.login((select rec from who));
insert into bl values
  (1, 1, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Consultation')), '[["upi", 1]]'),
  (2, 2, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Consultation')), '[["cash", 1]]'),
  (3, 3, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Hydrafacial')), '[["card", 1]]'),
  (4, 3, 'pharmacy_invoice', jsonb_build_array(pg_temp.med_line('Sunscreen SPF 50', 1), pg_temp.med_line('Vitamin C serum', 1)), '[["card", 1]]'),
  (5, 5, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Consultation')), '[["upi", 1]]'),
  (6, 6, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Consultation')), '[["cash", 1]]'),
  (7, 6, 'pharmacy_invoice', jsonb_build_array(pg_temp.med_line('Minoxidil 5% solution', 1), pg_temp.med_line('Biotin 10 mg', 30)), '[["upi", 1]]'),
  (8, 7, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Chemical peel')), '[["upi", 0.6]]'),
  (9, 9, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('PRP hair therapy')), '[["card", 1]]'),
  (10, 10, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Consultation')), '[["cash", 1]]'),
  (11, 11, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Botox (per area)', 2)), '[["card", 0.5], ["upi", 0.3]]'),
  (12, 12, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Consultation')), '[["upi", 1]]'),
  (13, 12, 'pharmacy_invoice', jsonb_build_array(pg_temp.med_line('Cetirizine 10 mg', 10), pg_temp.med_line('Mupirocin 2% ointment', 1)), '[["cash", 1]]'),
  (14, 13, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Microneedling with PRP')), '[["upi", 1]]'),
  (15, 14, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Consultation')), '[["upi", 1]]'),
  (16, 15, 'procedure_receipt', jsonb_build_array(pg_temp.service_line('Consultation')), '[["cash", 1]]'),
  (17, 15, 'pharmacy_invoice', jsonb_build_array(pg_temp.med_line('Tranexamic acid cream', 1), pg_temp.med_line('Ceramide moisturiser', 1)), '[["upi", 1]]');

do $$
declare r record; v_total bigint; v_pay jsonb; v_pid uuid; v_at timestamptz;
begin
  for r in select bl.*, ap.at, ap.id as appt_id, pt.id as pid from bl join ap on ap.n = bl.appt join pt on pt.n = ap.patient order by bl.n loop
    -- Total first (lines are priced on the server), then the payments as shares of it.
    v_total := (select sum((i ->> 'rate_paise')::bigint * (i ->> 'qty')::numeric) from jsonb_array_elements(r.items) i);
    select coalesce(jsonb_agg(jsonb_build_object('mode_id', case p ->> 0 when 'cash' then m.cash when 'upi' then m.upi else m.card end,
                                                 'amount_paise', round(v_total * (p ->> 1)::numeric))), '[]')
      into v_pay from jsonb_array_elements(r.pay) p, mode m;
    perform pg_temp.bill(r.n, r.type, r.pid,
      case when r.type = 'procedure_receipt' then jsonb_build_object('appointment_id', r.appt_id) else '{}'::jsonb end,
      r.items, v_pay, r.at);
  end loop;
end $$;
select pg_temp.login(null);
-- Dated to the visit (bill, payments), as if made at the desk that day. Locked bills refuse edits, so
-- triggers are off for these date fixes only.
set local session_replication_role = replica;
update public.bills b set bill_at = ap.at + interval '30 minutes' + make_interval(mins => bl.n % 3),
  finalized_at = ap.at + interval '30 minutes', created_at = ap.at + interval '20 minutes'
from bl join ap on ap.n = bl.appt where b.id = ('44444444-0000-4000-a000-' || lpad(bl.n::text, 12, '0'))::uuid;
update public.payments p set received_at = b.bill_at, created_at = b.bill_at
from public.payment_allocations a join public.bills b on b.id = a.bill_id where a.payment_id = p.id;
set local session_replication_role = origin;

------------------------------------------------------------------------------
-- A laser package (6 sessions, 2 done) for Ananya
------------------------------------------------------------------------------
select pg_temp.login((select rec from who));
select public.start_treatment(jsonb_build_object('patient_id', (select id from pt where n = 1),
  'template_id', (select id from public.treatment_templates where name like 'Laser hair%'),
  'doctor_id', '00000000-0000-4000-b000-000000000001', 'start_date', (now() at time zone 'Asia/Kolkata')::date - 28),
  '55555555-0000-4000-a000-000000000001');
select public.set_session_status(id, 'done', 'Session went well') from public.treatment_sessions
 where treatment_id = '55555555-0000-4000-a000-000000000001' and seq <= 2;

------------------------------------------------------------------------------
-- In-patient stays: Suresh (septoplasty, discharged last week, final bill paid with his advance + UPI)
-- and Arjun (rhinoplasty, admitted yesterday, still in)
------------------------------------------------------------------------------
select public.add_payment(jsonb_build_object('patient_id', (select id from pt where n = 10), 'kind', 'advance',
  'mode_id', (select upi from mode), 'amount_paise', 2000000, 'reference', 'UPI 4471 2210'), '66666666-0000-4000-a000-000000000001');
select public.admit_patient(jsonb_build_object('patient_id', (select id from pt where n = 10), 'admitted_at', now() - interval '9 days',
  'room_type_id', (select id from public.room_types where name = 'Semi deluxe room'), 'room_label', 'Semi deluxe 2',
  'procedures', jsonb_build_array('Septoplasty'), 'anaesthesia', 'General anaesthesia', 'diagnosis', 'Deviated nasal septum',
  'surgery_at', now() - interval '8 days',
  'surgeons', jsonb_build_array(jsonb_build_object('doctor_id', '00000000-0000-4000-b000-000000000002', 'role', 'primary'))),
  '66666666-1111-4000-a000-000000000001');
select public.discharge_patient('66666666-1111-4000-a000-000000000001', now() - interval '6 days');
select public.create_bill('final_bill', (select id from pt where n = 10), '{"admission_id": "66666666-1111-4000-a000-000000000001"}',
  '44444444-0000-4000-a000-0000000000f1');
do $$
declare v jsonb; v_cat jsonb;
begin
  select jsonb_object_agg(code, id) into v_cat from public.lookup_values where kind = 'bill_category';
  v := public.save_bill('44444444-0000-4000-a000-0000000000f1', '{}', jsonb_build_array(
    jsonb_build_object('kind', 'room', 'room_type_id', (select id from public.room_types where name = 'Semi deluxe room'),
      'description', 'Semi deluxe room', 'category_id', v_cat ->> 'room', 'rate_paise', 350000, 'qty', 3, 'gst_rate_bp', 0),
    pg_temp.service_line('Septoplasty surgery') || jsonb_build_object('doctor_id', '00000000-0000-4000-b000-000000000002'),
    pg_temp.service_line('OT charges'),
    pg_temp.service_line('Anaesthetist charges'),
    pg_temp.service_line('Nursing charges (per day)', 3),
    pg_temp.service_line('Dressing', 2),
    jsonb_build_object('kind', 'custom', 'description', 'Surgical consumables (nasal pack, sutures)', 'category_id', v_cat ->> 'consumables',
      'rate_paise', 420000, 'qty', 1, 'gst_rate_bp', 1200),
    pg_temp.med_line('Azithromycin 500 mg', 3), pg_temp.med_line('Paracetamol', 10), pg_temp.med_line('Mupirocin 2% ointment', 1)), 1);
  perform public.finalize_bill('44444444-0000-4000-a000-0000000000f1', (v ->> 'version')::int,
    jsonb_build_array(jsonb_build_object('mode_id', (select upi from mode),
      'amount_paise', (v ->> 'total_paise')::bigint - 2000000)), 2000000);
end $$;

select public.admit_patient(jsonb_build_object('patient_id', (select id from pt where n = 6), 'admitted_at', now() - interval '26 hours',
  'room_type_id', (select id from public.room_types where name = 'Deluxe room'), 'room_label', 'Deluxe 1',
  'procedures', jsonb_build_array('Rhinoplasty'), 'anaesthesia', 'General anaesthesia', 'diagnosis', 'Nasal hump (cosmetic)',
  'surgery_at', now() - interval '22 hours',
  'surgeons', jsonb_build_array(jsonb_build_object('doctor_id', '00000000-0000-4000-b000-000000000002', 'role', 'primary'))),
  '66666666-1111-4000-a000-000000000002');
select public.add_stay_charge('66666666-1111-4000-a000-000000000002', pg_temp.service_line('Rhinoplasty surgery'), '66666666-2222-4000-a000-000000000001');
select public.add_stay_charge('66666666-1111-4000-a000-000000000002', pg_temp.service_line('OT charges'), '66666666-2222-4000-a000-000000000002');
select pg_temp.login(null);
set local session_replication_role = replica;
update public.bills set bill_at = now() - interval '6 days', finalized_at = now() - interval '6 days', created_at = now() - interval '6 days'
 where id = '44444444-0000-4000-a000-0000000000f1';
update public.payments p set received_at = now() - interval '9 days', created_at = now() - interval '9 days'
 where id = '66666666-0000-4000-a000-000000000001';
update public.payments p set received_at = now() - interval '6 days', created_at = now() - interval '6 days'
 from public.payment_allocations a where a.payment_id = p.id and a.bill_id = '44444444-0000-4000-a000-0000000000f1'
   and p.id <> '66666666-0000-4000-a000-000000000001';
set local session_replication_role = origin;

------------------------------------------------------------------------------
-- Leads: 40 enquiries over the last month from ads, WhatsApp, Google, referrals, walk-ins, a BDM visit;
-- the manager shares them between Sunil and Neha, who call and move them along.
------------------------------------------------------------------------------
create temp table ld (n int, name text, src text, treat text, stage text, owner uuid, age_days int, id uuid) on commit drop;
grant all on ld to authenticated;
insert into ld (n, name, src, treat, stage, owner, age_days)
select row_number() over (), v.name, v.src, v.treat, v.stage,
       case when row_number() over () % 2 = 0 then '00000000-0000-4000-a000-000000000009'::uuid else '00000000-0000-4000-a000-000000000004'::uuid end,
       v.age
from (values
  ('Tanvi Kulkarni', 'facebook', 'Laser hair reduction', 'new', 0), ('Mohammed Irfan', 'instagram', 'Hair transplant', 'new', 0),
  ('Shruti Pai', 'facebook', 'Hydrafacial', 'new', 0), ('Varun Reddy', 'google', 'Rhinoplasty', 'new', 1),
  ('Keerthana S', 'whatsapp', 'Acne scar treatment', 'new', 1), ('Abhishek Jain', 'facebook', 'Hair transplant', 'new', 1),
  ('Nandini Gowda', 'instagram', 'Pigmentation', 'new', 2), ('Rakesh Yadav', 'website', 'Gynecomastia', 'new', 2),
  ('Isha Malhotra', 'facebook', 'Botox', 'contacted', 3), ('Pradeep Shetty', 'google', 'Hair transplant', 'contacted', 4),
  ('Sowmya Rao', 'whatsapp', 'Laser hair reduction', 'contacted', 4), ('Kunal Bose', 'facebook', 'PRP hair therapy', 'contacted', 5),
  ('Aishwarya N', 'instagram', 'Hydrafacial', 'contacted', 6), ('Yash Agarwal', 'facebook', 'Rhinoplasty', 'contacted', 7),
  ('Chaitra M', 'referral', 'Chemical peel', 'contacted', 8), ('Siddharth Iyer', 'google', 'Liposuction', 'interested', 6),
  ('Madhuri Desai', 'facebook', 'Laser hair reduction', 'interested', 7), ('Naveen Kumar', 'whatsapp', 'Hair transplant', 'interested', 8),
  ('Ramya Krishna', 'instagram', 'Botox', 'interested', 9), ('Tarun Mehra', 'facebook', 'Gynecomastia', 'interested', 10),
  ('Bindu Hegde', 'website', 'Pigmentation', 'interested', 11), ('Arvind Rao', 'google', 'Rhinoplasty', 'interested', 12),
  ('Pallavi Joshi', 'facebook', 'Hydrafacial', 'consultation_booked', 9), ('Sameer Khan', 'instagram', 'Hair transplant', 'consultation_booked', 10),
  ('Geetha Ramesh', 'whatsapp', 'Acne scar treatment', 'consultation_booked', 12), ('Rohit Sinha', 'facebook', 'PRP hair therapy', 'consultation_booked', 13),
  ('Vidya Shankar', 'referral', 'Laser hair reduction', 'consultation_booked', 14), ('Ajay Nair', 'google', 'Rhinoplasty', 'consulted', 16),
  ('Sunitha B', 'facebook', 'Botox', 'consulted', 18), ('Harsha Vardhan', 'bdm', 'Hair transplant', 'consulted', 19),
  ('Kiran Patel', 'instagram', 'Liposuction', 'surgery_scheduled', 20), ('Lavanya Reddy', 'facebook', 'Rhinoplasty', 'surgery_scheduled', 21),
  ('Mahesh Babu R', 'google', 'Hair transplant', 'converted', 22), ('Shilpa Shetty K', 'whatsapp', 'Laser hair reduction', 'converted', 24),
  ('Deepak Choudhary', 'facebook', 'PRP hair therapy', 'converted', 26), ('Anita George', 'facebook', 'Hydrafacial', 'lost', 15),
  ('Sandeep Gupta', 'instagram', 'Hair transplant', 'lost', 20), ('Rekha Iyengar', 'google', 'Botox', 'lost', 25),
  ('Vivek Menon', 'facebook', 'Rhinoplasty', 'not_reachable', 5), ('Asha Kumari', 'walk_in', 'Pigmentation', 'not_reachable', 9)
) v (name, src, treat, stage, age);
update ld set id = ('77777777-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid;

select pg_temp.login((select mgr from who));
select public.create_lead(jsonb_build_object('name', name, 'phone', '+9190002' || lpad((10000 + n)::text, 5, '0'),
         'source_code', src, 'treatment_text', treat, 'assigned_to', owner, 'force', true, 'via', 'web'), id)
from ld order by n;

-- Each owner calls their leads; the call moves the stage (and a next call date for the open ones).
do $$
declare r record; v_lost uuid := (select id from public.lookup_values where kind = 'lost_reason' and code = 'price');
begin
  for r in select * from ld where stage <> 'new' order by n loop
    perform pg_temp.login(r.owner);
    perform public.log_call(jsonb_build_object('client_id', ('88888888-0000-4000-a000-' || lpad(r.n::text, 12, '0'))::uuid,
      'lead_id', r.id, 'phone', '+9190002' || lpad((10000 + r.n)::text, 5, '0'), 'direction', 'outgoing',
      'duration_s', case when r.stage = 'not_reachable' then 0 else 90 + (r.n * 37) % 300 end,
      'outcome', case when r.stage = 'not_reachable' then 'no_answer' else 'connected' end,
      'notes', case r.stage when 'contacted' then 'Shared prices on WhatsApp; will discuss at home.'
                            when 'interested' then 'Keen. Wants to know about EMI and recovery time.'
                            when 'lost' then 'Found it costly, comparing with another clinic.'
                            else 'Explained the procedure and the consultation fee.' end,
      'stage', case when r.stage = 'contacted' then null else r.stage end,
      'lost_reason_id', case when r.stage = 'lost' then v_lost end,
      'next_followup_at', case when r.stage in ('contacted', 'interested', 'not_reachable')
                               then ((now() at time zone 'Asia/Kolkata')::date + (r.n % 3) + time '17:30') at time zone 'Asia/Kolkata' end));
  end loop;
end $$;
select pg_temp.login(null);
update public.leads l set lead_date = ((now() - make_interval(days => ld.age_days)) at time zone 'Asia/Kolkata')::date,
  created_at = now() - make_interval(days => ld.age_days, hours => ld.n % 5)
from ld where l.id = ld.id;
-- Most first calls within the hour (a few late), as the dashboard measures.
update public.call_logs c set started_at = l.created_at + make_interval(mins => 12 + (ld.n * 11) % 70),
                              created_at = l.created_at + make_interval(mins => 12 + (ld.n * 11) % 70)
from public.leads l join ld on ld.id = l.id where c.lead_id = l.id;
update public.leads l set first_call_at = c.started_at, last_activity_at = c.started_at
from public.call_logs c where c.lead_id = l.id;

-- Consultations the leads booked: done for those who came (consulted and beyond), upcoming for the booked ones.
insert into public.appointments (id, lead_id, doctor_id, appt_date, slot_start, slot_end, type, status,
  confirmed_via, confirmed_at, booked_by, booked_from, arrived_at, with_doctor_at, done_at, created_at)
select ('33333333-1111-4000-a000-' || lpad(ld.n::text, 12, '0'))::uuid, ld.id,
  ('00000000-0000-4000-b000-00000000000' || (1 + ld.n % 3))::uuid, (x.at at time zone 'Asia/Kolkata')::date, x.at, x.at + interval '15 minutes',
  'consultation', case when ld.stage = 'consultation_booked' then 'confirmed' else 'done' end::public.appt_status,
  'whatsapp', x.at - interval '1 day', ld.owner, 'android',
  case when ld.stage <> 'consultation_booked' then x.at - interval '8 minutes' end,
  case when ld.stage <> 'consultation_booked' then x.at + interval '4 minutes' end,
  case when ld.stage <> 'consultation_booked' then x.at + interval '22 minutes' end,
  l.created_at + interval '2 hours'
from ld join public.leads l on l.id = ld.id
cross join lateral (select case when ld.stage = 'consultation_booked'
    then ((((now() at time zone 'Asia/Kolkata')::date + 1 + ld.n % 3) + time '11:00' + make_interval(mins => 15 * (ld.n % 4))) at time zone 'Asia/Kolkata')
    else (((l.created_at at time zone 'Asia/Kolkata')::date + 3) + time '11:00' + make_interval(mins => 15 * (ld.n % 4))) at time zone 'Asia/Kolkata' end as at) x
where ld.stage in ('consultation_booked', 'consulted', 'surgery_scheduled', 'converted');
-- Converted leads become patients (their own files).
update public.leads l set patient_id = pt.id, converted_at = l.created_at + interval '5 days'
from ld join pt on pt.n = ld.n - 30 where l.id = ld.id and ld.stage = 'converted';
-- Today's enquiries came in during the last hour (first call due within the hour); older new ones are overdue.
update public.leads l set created_at = now() - make_interval(mins => 12 * ld.n),
  next_followup_at = now() - make_interval(mins => 12 * ld.n) + interval '1 hour'
from ld where l.id = ld.id and ld.age_days = 0;
update public.leads l set next_followup_at = l.created_at + interval '1 hour'
from ld where l.id = ld.id and ld.stage = 'new' and ld.age_days > 0;

-- Agreed amounts for the leads that fixed a surgery date or converted (the owner records them).
do $$
declare r record;
begin
  for r in select * from ld where stage in ('surgery_scheduled', 'converted') order by n loop
    perform pg_temp.login(r.owner);
    perform public.set_amount_finalised(r.id, case r.treat
      when 'Hair transplant' then 12000000 when 'Rhinoplasty' then 15000000 when 'Liposuction' then 18000000
      when 'Laser hair reduction' then 3600000 when 'PRP hair therapy' then 2400000 else 1800000 end);
  end loop;
end $$;
select pg_temp.login(null);
update public.leads l set amount_finalised_at = l.created_at + interval '4 days'
from ld where l.id = ld.id and ld.stage in ('surgery_scheduled', 'converted');

-- Monthly targets for the two executives (set by the admin), last month and this month.
select pg_temp.login((select admin from who));
select public.set_sales_target(s, mo, m, t)
from unnest(array['00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000009']::uuid[]) s,
     unnest(array[date_trunc('month', now() at time zone 'Asia/Kolkata')::date,
                  (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month')::date]) mo,
     (values ('converted', 4::bigint), ('calls', 30), ('agreed_paise', 40000000)) x (m, t);
select pg_temp.login(null);

-- Round-robin: new leads without an owner go to Sunil and Neha. The automatic-test logins stay out of the demo.
insert into public.lead_pool (staff_id, active, sort)
values ('00000000-0000-4000-a000-000000000004', true, 10), ('00000000-0000-4000-a000-000000000009', true, 20)
on conflict (staff_id) do update set active = true, sort = excluded.sort;
update public.staff set active = false, deactivated_at = now() where username in ('e2e_sales', 'e2e_bdm');

-- Facebook / Instagram ads (fake account and campaigns, as if synced from Meta) with daily spend for 45 days.
insert into public.ad_account (id, name, currency, timezone, synced_through, backfilled_from, last_synced_at)
values ('1000200030004', 'Pearl Aesthetic Clinic', 'INR', 'Asia/Kolkata', (now() at time zone 'Asia/Kolkata')::date,
        (now() at time zone 'Asia/Kolkata')::date - 45, now() - interval '25 minutes');
insert into public.ad_campaigns (id, account_id, name, objective, status, effective_status, daily_budget_paise, created_time, start_time)
values ('120200000000000001', '1000200030004', 'Hair transplant — Bengaluru', 'OUTCOME_LEADS', 'ACTIVE', 'ACTIVE', 250000, now() - interval '50 days', now() - interval '45 days'),
       ('120200000000000002', '1000200030004', 'Laser hair reduction — festive offer', 'OUTCOME_LEADS', 'ACTIVE', 'ACTIVE', 150000, now() - interval '40 days', now() - interval '35 days'),
       ('120200000000000003', '1000200030004', 'Rhinoplasty consultations', 'OUTCOME_LEADS', 'ACTIVE', 'ACTIVE', 180000, now() - interval '50 days', now() - interval '45 days'),
       ('120200000000000004', '1000200030004', 'Skin glow — Hydrafacial', 'OUTCOME_LEADS', 'PAUSED', 'PAUSED', 100000, now() - interval '50 days', now() - interval '45 days');
insert into public.ad_daily (campaign_id, day, spend_paise, impressions, reach, clicks, link_clicks, meta_leads)
select c.id, d::date,
       c.daily_budget_paise * (80 + (i * 7 + length(c.id)) % 35) / 100,
       c.daily_budget_paise / 100 * (3 + i % 4),
       c.daily_budget_paise / 100 * (2 + i % 3),
       c.daily_budget_paise / 1000 * (4 + i % 5),
       c.daily_budget_paise / 1000 * (3 + i % 4),
       (i + ascii(right(c.id, 1))) % 3
from public.ad_campaigns c,
     generate_series(0, 44) i,
     lateral (select (now() at time zone 'Asia/Kolkata')::date - i as d) x
where c.id <> '120200000000000004' or i > 12;
update public.leads l set source_detail = coalesce(l.source_detail, '{}'::jsonb) || jsonb_build_object('campaign_id', case
    when l.treatment_text in ('Hair transplant', 'PRP hair therapy') then '120200000000000001'
    when l.treatment_text = 'Laser hair reduction' then '120200000000000002'
    when l.treatment_text in ('Rhinoplasty', 'Liposuction', 'Gynecomastia') then '120200000000000003'
    else '120200000000000004' end)
from ld where l.id = ld.id and ld.src in ('facebook', 'instagram');

------------------------------------------------------------------------------
-- Dashboards read daily totals: rebuild them for the backdated history.
------------------------------------------------------------------------------
insert into public.kpi_dirty_days (day)
select d::date from generate_series((now() at time zone 'Asia/Kolkata')::date - 70, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d
on conflict do nothing;
select private.kpi_recompute_dirty(100);

-- (more sections above this line)
commit;
