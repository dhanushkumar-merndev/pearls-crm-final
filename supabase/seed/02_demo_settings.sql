-- FAKE demo clinic, settings, number series and integration status.
-- Runs locally after 01_users.sql, and online via `pnpm staging:bootstrap`.
-- Safe to run again: every insert skips rows that already exist. Never real clinic details.

insert into public.clinic_settings (
  branch_code, name, legal_name, gstin, llpin, address_lines, city, state, state_code,
  pincode, phones, email, website, signatory_label, terms
) values (
  'main', 'Demo Aesthetic Clinic', 'Demo Aesthetics LLP', '29ABCDE1234F1Z5', 'AAA-0000',
  array['1st Floor, Demo Building', '100 Feet Road'], 'Bengaluru', 'Karnataka', '29', '560001',
  array['+91 90000 00000'], 'clinic@example.com', 'https://example.com', 'Authorized Signatory',
  jsonb_build_object(
    'procedure_receipt', jsonb_build_array('Demo term 1.', 'Demo term 2.'),
    'pharmacy_invoice', jsonb_build_array('Demo term 1.'),
    'final_bill', jsonb_build_array('Demo term 1.')
  )
)
on conflict do nothing;

insert into public.app_settings (section, value) values
  ('ui', '{"default_theme": "dark"}'),
  ('security', '{"idle_logout_minutes": 15}')
on conflict do nothing;

insert into public.number_series (series_key, fy, prefix, format, next_value) values
  ('uhid', 'ALL', 'DEMO', '{prefix}{n}', 1001),
  ('procedure_receipt', '2026-27', 'DEMO', '{prefix}/{fy}/{n}', 1),
  ('pharmacy_invoice', '2026-27', 'DEMO', '{prefix}/{fy}/{n}', 1),
  ('final_bill', '2026-27', 'DEMO', '{prefix}/{fy}/{n}', 1)
on conflict do nothing;

insert into public.integration_status (integration, state) values
  ('whatsapp', 'off'), ('meta_leads', 'off'), ('brevo', 'unknown'),
  ('ors', 'off'), ('fcm', 'off'), ('tigris', 'unknown')
on conflict do nothing;

-- Phase 1 demo libraries (fake). Doctors work Mon–Sat 10:00–13:00 and 14:00–18:00.
insert into public.doctors (id, full_name, display_name, specialization, qualification, designation,
                            reg_council, reg_number, consultation_fee_paise, colour_slot, sort) values
  ('00000000-0000-4000-b000-000000000001', 'Dr Demo Priya Rao', 'Dr Priya', 'Dermatology', 'MBBS, MD (Derm)',
   'Consultant Dermatologist', 'Demo Medical Council', 'DMC-0001', 50000, 0, 10),
  ('00000000-0000-4000-b000-000000000002', 'Dr Demo Arjun Shetty', 'Dr Arjun', 'Plastic Surgery', 'MBBS, MS, MCh',
   'Consultant Plastic Surgeon', 'Demo Medical Council', 'DMC-0002', 80000, 1, 20)
on conflict do nothing;
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time)
select d, w, s, e
from unnest(array['00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002']::uuid[]) d,
     generate_series(1, 6) w,
     (values ('10:00'::time, '13:00'::time), ('14:00', '18:00')) h (s, e)
on conflict do nothing;

insert into public.services (name, category_id, default_price_paise, gst_rate_bp, usage_count)
select v.name, (select id from public.lookup_values where kind = 'bill_category' and code = v.cat), v.price, 0, v.used
from (values
  ('Consultation', 'consultation', 50000, 50),
  ('Hydrafacial', 'procedure', 350000, 30),
  ('Laser hair reduction (full face)', 'procedure', 400000, 25),
  ('Chemical peel', 'procedure', 250000, 20),
  ('PRP hair therapy', 'procedure', 600000, 15),
  ('Septoplasty surgery', 'surgeon', 4500000, 5),
  ('Nursing charges (per day)', 'ip_services', 150000, 5),
  ('OT charges', 'ip_services', 1000000, 5)
) as v (name, cat, price, used)
on conflict do nothing;

insert into public.treatment_templates (name, category, default_sessions, gap_days, pricing, default_price_paise, usage_count)
values
  ('Laser hair reduction — 6 sessions', 'non_surgical', 6, '{0,30,60,90,120,150}', 'package', 2000000, 10),
  ('PRP hair therapy — 4 sessions', 'non_surgical', 4, '{0,30,60,90}', 'package', 2000000, 8),
  ('Septoplasty', 'surgery_ip', 1, '{0}', 'package', 7500000, 3)
on conflict do nothing;

insert into public.room_types (name, daily_rate_paise, gst_rate_bp) values
  ('General ward', 200000, 0), ('Semi deluxe room', 350000, 0), ('Deluxe room', 500000, 0)
on conflict do nothing;

insert into public.pharmacy_items (name, strength, form, manufacturer, hsn, gst_rate_bp, mrp_paise, selling_price_paise,
                                   purchase_price_paise, sell_unit, reorder_level) values
  ('Demo Sunscreen SPF 50', '50 g', 'Cream', 'Demo Pharma', '33049990', 1800, 69500, 69500, 45000, 'tube', 5),
  ('Demo Paracetamol', '650 mg', 'Tablet', 'Demo Pharma', '30049099', 500, 3000, 3000, 1800, 'strip', 10),
  ('Demo Amoxicillin', '500 mg', 'Capsule', 'Demo Pharma', '30041090', 500, 12000, 12000, 8000, 'strip', 10)
on conflict do nothing;

insert into public.holidays (day, name) values ('2026-11-08', 'Demo holiday (Deepavali)')
on conflict do nothing;
