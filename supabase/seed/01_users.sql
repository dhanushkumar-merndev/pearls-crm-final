-- FAKE local-only logins. Never applied online: staging users come from
-- `pnpm staging:bootstrap` with a random password (STAGING_TEST_PASSWORD).
-- Every login is a USERNAME + password (password for all: Pearl@2026):
--   admin · reception · reception2 · manager · sales · bdm

do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'admin',      'admin'::public.staff_role, 'Asha Admin'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'reception',  'receptionist',             'Rekha Reception'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'manager',    'sales_manager',            'Manoj Manager'),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'sales',      'sales_executive',          'Sunil Sales'),
      ('00000000-0000-4000-a000-000000000005'::uuid, 'bdm',        'bdm',                      'Bhavya BDM'),
      ('00000000-0000-4000-a000-000000000006'::uuid, 'reception2', 'receptionist',             'Radha Reception')
    ) as t (id, username, role, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.username || '@staff.invalid',
      extensions.crypt('Pearl@2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.username || '@staff.invalid', 'email_verified', true),
            'email', now(), now(), now());
    insert into public.staff (id, role, full_name, username, phone_e164)
    values (u.id, u.role, u.full_name, u.username, '+9190000000' || right(u.id::text, 2));
  end loop;
end $$;
