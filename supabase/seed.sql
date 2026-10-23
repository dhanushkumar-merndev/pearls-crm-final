-- FAKE local/staging data only. Never real patients, staff or clinic details.
-- Logins (password for all: Pearl@2026):
--   admin@pearl.test · reception@pearl.test · manager@pearl.test · sales@pearl.test · bdm@pearl.test
--   username login: "reception2" (no email; stored as reception2@staff.invalid)

do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@pearl.test',       'admin'::public.staff_role,  'Asha Admin',      null::text),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'reception@pearl.test',   'receptionist',              'Rekha Reception', null),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'manager@pearl.test',     'sales_manager',             'Manoj Manager',   null),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'sales@pearl.test',       'sales_executive',           'Sunil Sales',     null),
      ('00000000-0000-4000-a000-000000000005'::uuid, 'bdm@pearl.test',         'bdm',                       'Bhavya BDM',      null),
      ('00000000-0000-4000-a000-000000000006'::uuid, 'reception2@staff.invalid','receptionist',             'Radha Reception', 'reception2')
    ) as t (id, email, role, full_name, username)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('Pearl@2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
    insert into public.staff (id, role, full_name, username, email, phone_e164)
    values (u.id, u.role, u.full_name, u.username,
            case when u.email like '%@staff.invalid' then null else u.email end,
            '+9190000000' || right(u.id::text, 2));
  end loop;
end $$;

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
);

insert into public.app_settings (section, value) values
  ('ui', '{"default_theme": "dark"}'),
  ('security', '{"idle_logout_minutes": 15}');

insert into public.number_series (series_key, fy, prefix, format, next_value) values
  ('uhid', 'ALL', 'DEMO', '{prefix}{n}', 1001),
  ('procedure_receipt', '2026-27', 'DEMO', '{prefix}/{fy}/{n}', 1),
  ('pharmacy_invoice', '2026-27', 'DEMO', '{prefix}/{fy}/{n}', 1),
  ('final_bill', '2026-27', 'DEMO', '{prefix}/{fy}/{n}', 1);

insert into public.integration_status (integration, state) values
  ('whatsapp', 'off'), ('meta_leads', 'off'), ('brevo', 'unknown'),
  ('ors', 'off'), ('fcm', 'off'), ('tigris', 'unknown');
