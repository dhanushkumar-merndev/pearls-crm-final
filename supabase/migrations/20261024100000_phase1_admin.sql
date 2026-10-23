-- Pearl CRM — Phase 1: admin setup and libraries (PLAN.md C3 "Settings", "People", "Libraries")
-- Doctors + schedules + leaves + holidays, user-extendable lists, service / treatment /
-- room / medicine libraries with on-the-fly items, library search (keyset), review,
-- merge, audit viewer, settings defaults, public-assets bucket for the logo.
--
-- Money is paise (bigint). GST rates are basis points (5% = 500), the same unit as
-- packages/shared/src/gst.ts, so no rate is ever a float.

------------------------------------------------------------------------------
-- Function privileges, fixed for good. PostgreSQL grants EXECUTE on every new
-- function to PUBLIC (which includes anon). A per-schema "alter default
-- privileges … revoke" (Phase 0) cannot take away that GLOBAL default, so new
-- functions were callable by logged-out visitors (each still refused them
-- inside via require_staff). Revoke it globally for the migration role, and
-- give every migration a final lock-down call.
------------------------------------------------------------------------------
alter default privileges revoke execute on functions from public;

create function private.lock_down_public_functions()
returns void
language plpgsql
as $$
begin
  revoke execute on all functions in schema public from public, anon;
  grant execute on function public.public_branding() to anon, authenticated;
  grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  revoke all on all tables in schema public from anon;
  revoke all on all sequences in schema public from anon;
end;
$$;

------------------------------------------------------------------------------
-- Types and helpers
------------------------------------------------------------------------------
create type public.treatment_category as enum ('surgery_ip', 'procedure', 'non_surgical', 'wellness');
-- In private: Postgres makes its constructor functions owned by supabase_admin, which our
-- migrations cannot lock down; anon has no access to the private schema at all.
create type private.timerange as range (subtype = time);

-- Escapes LIKE wildcards in user search text.
create function private.like_escape(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- One settings value with a fallback: private.setting('appointments', 'slot_minutes', '15').
create function private.setting(p_section text, p_key text, p_default jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.value -> p_key from public.app_settings s where s.section = p_section), p_default);
$$;

------------------------------------------------------------------------------
-- Lists (lead sources, lost reasons, bill categories, payment modes, …)
------------------------------------------------------------------------------
create table public.lookup_values (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'lead_source', 'lost_reason', 'referral_name', 'bill_category', 'payment_mode',
    'relation', 'document_kind', 'quick_reply', 'break_type'
  )),
  label text not null check (length(btrim(label)) between 1 and 120),
  code text check (code ~ '^[a-z0-9_]{1,40}$'),
  sort integer not null default 100,
  active boolean not null default true,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_on_the_fly boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references public.staff (id),
  merged_into_id uuid references public.lookup_values (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index lookup_values_label on public.lookup_values (kind, lower(label)) where merged_into_id is null;
create unique index lookup_values_code on public.lookup_values (kind, code) where code is not null;
create index lookup_values_trgm on public.lookup_values using gin (label extensions.gin_trgm_ops);
create index lookup_values_rank on public.lookup_values (kind, usage_count desc, lower(label), id) where active;
create index lookup_values_review on public.lookup_values (created_at) where created_on_the_fly and reviewed_at is null;
create trigger lookup_values_touch before update on public.lookup_values
  for each row execute function private.touch_updated();
create trigger lookup_values_audit after insert or update or delete on public.lookup_values
  for each row execute function private.audit_row();

-- System lists the app relies on (codes are stable; labels can be renamed by the admin).
insert into public.lookup_values (kind, code, label, sort) values
  ('payment_mode', 'cash', 'Cash', 10),
  ('payment_mode', 'upi', 'UPI', 20),
  ('payment_mode', 'card', 'Card', 30),
  ('payment_mode', 'bank_transfer', 'Bank transfer', 40),
  ('payment_mode', 'online', 'Online', 50),
  ('bill_category', 'consultation', 'Consultation', 10),
  ('bill_category', 'procedure', 'Procedure', 20),
  ('bill_category', 'pharmacy', 'Pharmacy', 30),
  ('bill_category', 'room', 'Room charges', 40),
  ('bill_category', 'surgeon', 'Surgeon charges', 50),
  ('bill_category', 'ip_services', 'In-patient services', 60),
  ('bill_category', 'consumables', 'Consumables', 70),
  ('bill_category', 'other', 'Other', 90),
  ('relation', 'spouse', 'Spouse', 10),
  ('relation', 'parent', 'Parent', 20),
  ('relation', 'child', 'Child', 30),
  ('relation', 'sibling', 'Sibling', 40),
  ('relation', 'friend', 'Friend', 50),
  ('relation', 'other', 'Other', 90),
  ('document_kind', 'prescription', 'Prescription', 10),
  ('document_kind', 'lab_report', 'Lab report', 20),
  ('document_kind', 'scan', 'Scan / X-ray', 30),
  ('document_kind', 'consent', 'Consent form', 40),
  ('document_kind', 'registration_form', 'Registration form', 50),
  ('document_kind', 'id_proof', 'ID proof', 60),
  ('document_kind', 'other', 'Other', 90),
  ('lead_source', 'walk_in', 'Walk-in', 10),
  ('lead_source', 'referral', 'Referral', 20),
  ('lead_source', 'facebook', 'Facebook', 30),
  ('lead_source', 'instagram', 'Instagram', 40),
  ('lead_source', 'google', 'Google', 50),
  ('lead_source', 'website', 'Website', 60),
  ('lead_source', 'bdm', 'BDM visit', 70),
  ('lead_source', 'other', 'Other', 90),
  ('lost_reason', 'price', 'Price too high', 10),
  ('lost_reason', 'not_interested', 'Not interested', 20),
  ('lost_reason', 'elsewhere', 'Went elsewhere', 30),
  ('lost_reason', 'not_reachable', 'Could not reach', 40),
  ('lost_reason', 'other', 'Other', 90),
  ('break_type', 'lunch', 'Lunch', 10),
  ('break_type', 'tea', 'Tea', 20),
  ('break_type', 'personal', 'Personal', 30);

------------------------------------------------------------------------------
-- Doctors, schedules, leaves, holidays
------------------------------------------------------------------------------
create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  display_name text check (length(display_name) <= 60),
  specialization text,
  qualification text,
  designation text,
  reg_council text,
  reg_number text,
  signature_file_id uuid references public.files (id),
  consultation_fee_paise bigint not null default 0 check (consultation_fee_paise >= 0),
  colour_slot smallint not null default 0 check (colour_slot between 0 and 7), -- chart palette slot
  slot_minutes smallint check (slot_minutes between 5 and 240),
  capacity_override smallint check (capacity_override between 1 and 50),
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index doctors_active on public.doctors (sort, full_name) where active;
create index doctors_trgm on public.doctors using gin (full_name extensions.gin_trgm_ops);
create trigger doctors_touch before update on public.doctors
  for each row execute function private.touch_updated();
create trigger doctors_audit after insert or update or delete on public.doctors
  for each row execute function private.audit_row();

-- Weekly hours. weekday is ISO (1 = Monday … 7 = Sunday). Overlapping hours for the
-- same doctor and weekday (within overlapping validity dates) are refused by Postgres.
create table public.doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  slot_minutes smallint check (slot_minutes between 5 and 240),
  capacity smallint check (capacity between 1 and 50),
  valid_from date not null default '2000-01-01',
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (end_time > start_time),
  check (valid_to is null or valid_to >= valid_from),
  constraint doctor_schedules_no_overlap exclude using gist (
    doctor_id with =,
    weekday with =,
    private.timerange(start_time, end_time) with &&,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  )
);
create trigger doctor_schedules_touch before update on public.doctor_schedules
  for each row execute function private.touch_updated();
create trigger doctor_schedules_audit after insert or update or delete on public.doctor_schedules
  for each row execute function private.audit_row();

create table public.doctor_leaves (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  during tstzrange not null check (not isempty(during) and lower(during) is not null and upper(during) is not null),
  reason text check (length(reason) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint doctor_leaves_no_overlap exclude using gist (doctor_id with =, during with &&)
);
create trigger doctor_leaves_touch before update on public.doctor_leaves
  for each row execute function private.touch_updated();
create trigger doctor_leaves_audit after insert or update or delete on public.doctor_leaves
  for each row execute function private.audit_row();

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger holidays_touch before update on public.holidays
  for each row execute function private.touch_updated();
create trigger holidays_audit after insert or update or delete on public.holidays
  for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- Libraries
------------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  category_id uuid references public.lookup_values (id),
  default_price_paise bigint not null default 0 check (default_price_paise >= 0),
  sac text check (sac ~ '^[0-9]{4,8}$'),
  gst_rate_bp integer not null default 0 check (gst_rate_bp between 0 and 4000),
  doctor_id uuid references public.doctors (id),
  is_doctor_charge boolean not null default false,
  active boolean not null default true,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_on_the_fly boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references public.staff (id),
  merged_into_id uuid references public.services (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index services_name on public.services (lower(name)) where merged_into_id is null;
create index services_trgm on public.services using gin (name extensions.gin_trgm_ops);
create index services_rank on public.services (usage_count desc, lower(name), id) where active;
create index services_review on public.services (created_at) where created_on_the_fly and reviewed_at is null;
create trigger services_touch before update on public.services
  for each row execute function private.touch_updated();
create trigger services_audit after insert or update or delete on public.services
  for each row execute function private.audit_row();

create table public.treatment_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  category public.treatment_category not null default 'procedure',
  default_sessions smallint not null default 1 check (default_sessions between 1 and 100),
  -- Days after the start for each session, e.g. {0,14,30,60}.
  gap_days integer[] not null default '{0}' check (cardinality(gap_days) >= 1 and 0 <= all (gap_days)),
  session_minutes smallint check (session_minutes between 5 and 600),
  pricing text not null default 'package' check (pricing in ('per_session', 'package')),
  default_price_paise bigint not null default 0 check (default_price_paise >= 0),
  pre_care text,
  post_care text,
  follow_up_days smallint check (follow_up_days between 0 and 3650),
  drip_campaign_id uuid,       -- FK added in Phase 10
  discharge_template_id uuid,  -- FK added in Phase 7
  active boolean not null default true,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_on_the_fly boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references public.staff (id),
  merged_into_id uuid references public.treatment_templates (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index treatment_templates_name on public.treatment_templates (lower(name)) where merged_into_id is null;
create index treatment_templates_trgm on public.treatment_templates using gin (name extensions.gin_trgm_ops);
create index treatment_templates_rank on public.treatment_templates (usage_count desc, lower(name), id) where active;
create index treatment_templates_review on public.treatment_templates (created_at)
  where created_on_the_fly and reviewed_at is null;
create trigger treatment_templates_touch before update on public.treatment_templates
  for each row execute function private.touch_updated();
create trigger treatment_templates_audit after insert or update or delete on public.treatment_templates
  for each row execute function private.audit_row();

create table public.treatment_template_services (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.treatment_templates (id) on delete cascade,
  service_id uuid not null references public.services (id),
  qty numeric(10, 3) not null default 1 check (qty > 0),
  when_applied text not null default 'each_session' check (when_applied in ('each_session', 'once', 'ip_stay')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (template_id, service_id, when_applied)
);
create index treatment_template_services_service on public.treatment_template_services (service_id);
create trigger treatment_template_services_touch before update on public.treatment_template_services
  for each row execute function private.touch_updated();

create table public.room_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  daily_rate_paise bigint not null default 0 check (daily_rate_paise >= 0),
  sac text check (sac ~ '^[0-9]{4,8}$'),
  gst_rate_bp integer not null default 0 check (gst_rate_bp between 0 and 4000),
  active boolean not null default true,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_on_the_fly boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references public.staff (id),
  merged_into_id uuid references public.room_types (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index room_types_name on public.room_types (lower(name)) where merged_into_id is null;
create index room_types_rank on public.room_types (usage_count desc, lower(name), id) where active;
create trigger room_types_touch before update on public.room_types
  for each row execute function private.touch_updated();
create trigger room_types_audit after insert or update or delete on public.room_types
  for each row execute function private.audit_row();

create table public.pharmacy_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  form text check (length(form) <= 40),       -- tablet, syrup, cream…
  strength text check (length(strength) <= 60),
  manufacturer text check (length(manufacturer) <= 120),
  hsn text check (hsn ~ '^[0-9]{4,8}$'),
  gst_rate_bp integer not null default 0 check (gst_rate_bp between 0 and 4000),
  mrp_paise bigint not null default 0 check (mrp_paise >= 0),
  selling_price_paise bigint not null default 0 check (selling_price_paise >= 0),
  purchase_price_paise bigint not null default 0 check (purchase_price_paise >= 0),
  pack_size integer not null default 1 check (pack_size >= 1),
  sell_unit text not null default 'unit' check (length(sell_unit) <= 20),
  reorder_level numeric(10, 3) not null default 0 check (reorder_level >= 0),
  rack text check (length(rack) <= 40),
  active boolean not null default true,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_on_the_fly boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references public.staff (id),
  merged_into_id uuid references public.pharmacy_items (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index pharmacy_items_name on public.pharmacy_items (lower(name), coalesce(strength, ''), coalesce(form, ''))
  where merged_into_id is null;
create index pharmacy_items_trgm on public.pharmacy_items using gin (name extensions.gin_trgm_ops);
create index pharmacy_items_rank on public.pharmacy_items (usage_count desc, lower(name), id) where active;
create index pharmacy_items_review on public.pharmacy_items (created_at) where created_on_the_fly and reviewed_at is null;
create trigger pharmacy_items_touch before update on public.pharmacy_items
  for each row execute function private.touch_updated();
create trigger pharmacy_items_audit after insert or update or delete on public.pharmacy_items
  for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- Settings defaults (PLAN.md A2). Admin changes them on the Settings pages.
------------------------------------------------------------------------------
insert into public.app_settings (section, value) values
  ('appointments', jsonb_build_object(
    'slot_minutes', 15, 'capacity_per_slot', 3,
    'day_start', '10:00', 'day_end', '20:00', 'working_days', jsonb_build_array(1, 2, 3, 4, 5, 6),
    'confirm_hours_before', 4, 'reminder_hours_before', 24, 'walk_in_queue', true)),
  ('billing', jsonb_build_object(
    'tax_inclusive', true, 'round_to_rupee', false,
    'receptionist_max_discount_bp', 2000, 'agreed_price_categories_exclude', jsonb_build_array('pharmacy'),
    'ip_number_mode', 'separate')),
  ('pharmacy', jsonb_build_object(
    'near_expiry_days', jsonb_build_array(90, 60, 30), 'negative_stock', 'block', 'prices_include_gst', true)),
  ('sales', jsonb_build_object('round_robin', true, 'targets_enabled', false, 'reception_can_play_recordings', false)),
  ('notifications', jsonb_build_object('daily_summary_time', '20:00', 'daily_summary_enabled', true))
on conflict (section) do nothing;

------------------------------------------------------------------------------
-- Public files: clinic logo and staff photos (Supabase Storage, public bucket).
-- Private files (prescriptions, recordings) never go here; they live in Tigris.
------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-assets', 'public-assets', true, 524288, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy public_assets_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets' and (select private.has_role('admin')));
create policy public_assets_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'public-assets' and (select private.has_role('admin')))
  with check (bucket_id = 'public-assets' and (select private.has_role('admin')));
create policy public_assets_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets' and (select private.has_role('admin')));

------------------------------------------------------------------------------
-- Row Level Security: every active staff member reads; admin writes directly
-- (simple master data). Receptionists add items on the fly via library_create.
------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['lookup_values', 'doctors', 'doctor_schedules', 'doctor_leaves', 'holidays',
                           'services', 'treatment_templates', 'treatment_template_services',
                           'room_types', 'pharmacy_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using ((select private.my_role()) is not null)$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
                      with check ((select private.has_role('admin')))$p$, t || '_admin_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
                      using ((select private.has_role('admin'))) with check ((select private.has_role('admin')))$p$,
                   t || '_admin_update', t);
  end loop;
  -- Rows that are safe to remove outright (nothing else points at them).
  foreach t in array array['doctor_schedules', 'doctor_leaves', 'holidays', 'treatment_template_services'] loop
    execute format('grant delete on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
                      using ((select private.has_role('admin')))$p$, t || '_admin_delete', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- Library registry: one place that says which table backs each picker kind and
-- who may search or add to it.
------------------------------------------------------------------------------
create function private.library_spec(p_kind text)
returns table (
  tbl text, label_col text, lookup_kind text,
  search_roles public.staff_role[], create_roles public.staff_role[]
)
language sql
immutable
as $$
  select s.tbl, s.label_col, s.lookup_kind, s.search_roles, s.create_roles
  from (values
    ('service', 'services', 'name', null::text,
      array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('treatment_template', 'treatment_templates', 'name', null,
      array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[],
      array['receptionist', 'admin']::public.staff_role[]),
    ('room_type', 'room_types', 'name', null,
      array['receptionist', 'admin']::public.staff_role[], array['admin']::public.staff_role[]),
    ('pharmacy_item', 'pharmacy_items', 'name', null,
      array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('doctor', 'doctors', 'full_name', null,
      array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[], '{}'::public.staff_role[])
  ) as s (kind, tbl, label_col, lookup_kind, search_roles, create_roles)
  where s.kind = p_kind
  union all
  select 'lookup_values', 'label', l.kind, l.search_roles, l.create_roles
  from (values
    ('lead_source', array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[],
                    array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]),
    ('lost_reason', array['sales_executive', 'sales_manager', 'admin']::public.staff_role[],
                    array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]),
    ('referral_name', array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[],
                      array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]),
    ('bill_category', array['receptionist', 'sales_manager', 'admin']::public.staff_role[],
                      array['admin']::public.staff_role[]),
    ('payment_mode', array['receptionist', 'admin']::public.staff_role[], array['admin']::public.staff_role[]),
    ('relation', array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('document_kind', array['receptionist', 'admin']::public.staff_role[], array['receptionist', 'admin']::public.staff_role[]),
    ('quick_reply', array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[],
                    array['sales_manager', 'admin']::public.staff_role[]),
    ('break_type', array['bdm', 'admin']::public.staff_role[], array['admin']::public.staff_role[])
  ) as l (kind, search_roles, create_roles)
  where l.kind = p_kind;
$$;

-- One picker row as the apps see it.
create function private.library_item(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  case p_kind
    when 'service' then
      select jsonb_build_object('id', s.id, 'label', s.name,
        'subtitle', concat_ws(' · ', c.label, nullif(s.sac, '')),
        'on_the_fly', s.created_on_the_fly and s.reviewed_at is null,
        'defaults', jsonb_build_object('price_paise', s.default_price_paise, 'gst_rate_bp', s.gst_rate_bp,
          'sac', s.sac, 'category_id', s.category_id, 'category_code', c.code, 'doctor_id', s.doctor_id,
          'is_doctor_charge', s.is_doctor_charge))
      into v from public.services s left join public.lookup_values c on c.id = s.category_id where s.id = p_id;
    when 'treatment_template' then
      select jsonb_build_object('id', t.id, 'label', t.name, 'subtitle', t.category,
        'on_the_fly', t.created_on_the_fly and t.reviewed_at is null,
        'defaults', jsonb_build_object('category', t.category, 'sessions', t.default_sessions,
          'gap_days', to_jsonb(t.gap_days), 'pricing', t.pricing, 'price_paise', t.default_price_paise,
          'session_minutes', t.session_minutes, 'follow_up_days', t.follow_up_days))
      into v from public.treatment_templates t where t.id = p_id;
    when 'room_type' then
      select jsonb_build_object('id', r.id, 'label', r.name, 'subtitle', null,
        'on_the_fly', r.created_on_the_fly and r.reviewed_at is null,
        'defaults', jsonb_build_object('price_paise', r.daily_rate_paise, 'gst_rate_bp', r.gst_rate_bp, 'sac', r.sac))
      into v from public.room_types r where r.id = p_id;
    when 'pharmacy_item' then
      select jsonb_build_object('id', p.id, 'label', p.name,
        'subtitle', concat_ws(' · ', nullif(p.strength, ''), nullif(p.form, ''), nullif(p.manufacturer, '')),
        'on_the_fly', p.created_on_the_fly and p.reviewed_at is null,
        'defaults', jsonb_build_object('price_paise', p.selling_price_paise, 'mrp_paise', p.mrp_paise,
          'gst_rate_bp', p.gst_rate_bp, 'hsn', p.hsn, 'manufacturer', p.manufacturer, 'sell_unit', p.sell_unit))
      into v from public.pharmacy_items p where p.id = p_id;
    when 'doctor' then
      select jsonb_build_object('id', d.id, 'label', coalesce(d.display_name, d.full_name),
        'subtitle', d.specialization, 'on_the_fly', false,
        'defaults', jsonb_build_object('fee_paise', d.consultation_fee_paise, 'colour_slot', d.colour_slot))
      into v from public.doctors d where d.id = p_id;
    else
      select jsonb_build_object('id', l.id, 'label', l.label, 'subtitle', null,
        'on_the_fly', l.created_on_the_fly and l.reviewed_at is null,
        'defaults', jsonb_build_object('code', l.code))
      into v from public.lookup_values l where l.id = p_id and l.kind = p_kind;
  end case;
  return v;
end;
$$;

-- LibraryCombobox search. Empty q = most used first. Keyset paging: the cursor is the
-- last row's sort key, so "load 10 more" costs the same on page 1 and page 50.
-- Order: names starting with q first, then most used, then A–Z.
create function public.library_search(p_kind text, p_q text default '', p_cursor text default null, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_spec record;
  v_q text := lower(btrim(coalesce(p_q, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
  v_count integer;
  v_sql text;
  v_usage text;
begin
  select * into v_spec from private.library_spec(p_kind);
  if v_spec.tbl is null then
    perform private.fail('invalid_input', 'unknown library kind');
  end if;
  perform private.require_staff(v_spec.search_roles);

  -- Doctors have no usage counter: their admin-set sort order ranks them instead (lower first).
  v_usage := case when v_spec.tbl = 'doctors' then '-t.sort' else 't.usage_count' end;
  v_sql := format($q$
    with ranked as (
      select t.id,
             case when $1 <> '' and lower(t.%1$I) like private.like_escape($1) || '%%' then 0 else 1 end as k1,
             (%2$s)::bigint as k2,
             lower(t.%1$I) as k3
      from public.%3$I t
      where t.active
        and ($2::text is null or t.kind = $2)
        and ($1 = '' or t.%1$I ilike '%%' || private.like_escape($1) || '%%')
    ), page as (
      select * from ranked r
      where $3::jsonb is null
         or r.k1 > ($3 ->> 0)::int
         or (r.k1 = ($3 ->> 0)::int and (r.k2 < ($3 ->> 1)::bigint
             or (r.k2 = ($3 ->> 1)::bigint and (r.k3, r.id) > ($3 ->> 2, ($3 ->> 3)::uuid))))
      order by r.k1, r.k2 desc, r.k3, r.id
      limit $4 + 1
    )
    select coalesce(jsonb_agg(jsonb_build_array(p.id, p.k1, p.k2, p.k3) order by p.k1, p.k2 desc, p.k3, p.id), '[]'::jsonb)
    from page p
  $q$, v_spec.label_col, v_usage, v_spec.tbl);

  -- lookup_values has a kind column; other tables are filtered by the null kind.
  if v_spec.tbl <> 'lookup_values' then
    v_sql := replace(v_sql, 'and ($2::text is null or t.kind = $2)', 'and $2::text is null');
  end if;
  execute v_sql into v_rows using v_q, v_spec.lookup_kind, v_c, v_limit;

  v_count := jsonb_array_length(v_rows);
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(private.library_item(p_kind, (r.value ->> 0)::uuid) order by r.ordinality)
      from jsonb_array_elements(v_rows) with ordinality r
      where r.ordinality <= v_limit), '[]'::jsonb),
    'next_cursor', case when v_count > v_limit then
      (select jsonb_build_array((x -> 1)::int, (x -> 2)::bigint, x ->> 3, x ->> 0)::text
         from (select v_rows -> (v_limit - 1) as x) last)
      end
  );
end;
$$;

-- Add an item from a picker ("Add 'Hydrafacial'"). Flagged for the admin's review.
-- Idempotent on p_client_id; an existing item with the same name is returned instead.
create function public.library_create(p_kind text, p_payload jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spec record;
  v_label text := btrim(coalesce(p_payload ->> 'label', ''));
  v_id uuid;
  v_price bigint := greatest(coalesce((p_payload ->> 'price_paise')::bigint, 0), 0);
  v_gst integer := coalesce((p_payload ->> 'gst_rate_bp')::integer, 0);
begin
  select * into v_spec from private.library_spec(p_kind);
  if v_spec.tbl is null or cardinality(v_spec.create_roles) = 0 then
    perform private.fail('invalid_input', 'items of this kind cannot be added here');
  end if;
  perform private.require_staff(v_spec.create_roles);
  if length(v_label) = 0 or length(v_label) > 200 then
    perform private.fail('invalid_input', 'name is required');
  end if;
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id is required');
  end if;
  if v_gst < 0 or v_gst > 4000 then
    perform private.fail('invalid_input', 'gst rate');
  end if;

  case p_kind
    when 'service' then
      select id into v_id from public.services where id = p_client_id
         or (lower(name) = lower(v_label) and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.services (id, name, default_price_paise, gst_rate_bp, category_id, created_on_the_fly)
        values (p_client_id, v_label, v_price, v_gst, (p_payload ->> 'category_id')::uuid, true)
        returning id into v_id;
      end if;
    when 'treatment_template' then
      select id into v_id from public.treatment_templates where id = p_client_id
         or (lower(name) = lower(v_label) and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.treatment_templates (id, name, default_price_paise, created_on_the_fly)
        values (p_client_id, v_label, v_price, true)
        returning id into v_id;
      end if;
    when 'room_type' then
      select id into v_id from public.room_types where id = p_client_id
         or (lower(name) = lower(v_label) and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.room_types (id, name, daily_rate_paise, gst_rate_bp, created_on_the_fly)
        values (p_client_id, v_label, v_price, v_gst, true)
        returning id into v_id;
      end if;
    when 'pharmacy_item' then
      select id into v_id from public.pharmacy_items where id = p_client_id
         or (lower(name) = lower(v_label) and strength is null and form is null and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.pharmacy_items (id, name, selling_price_paise, mrp_paise, gst_rate_bp, created_on_the_fly)
        values (p_client_id, v_label, v_price, v_price, v_gst, true)
        returning id into v_id;
      end if;
    else
      select id into v_id from public.lookup_values where id = p_client_id
         or (kind = v_spec.lookup_kind and lower(label) = lower(v_label) and merged_into_id is null) limit 1;
      if v_id is null then
        insert into public.lookup_values (id, kind, label, created_on_the_fly)
        values (p_client_id, v_spec.lookup_kind, v_label, true)
        returning id into v_id;
      end if;
  end case;

  return private.library_item(p_kind, v_id);
end;
$$;

-- Called by later RPCs each time an item is used, so pickers show the most used first.
create function private.library_used(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_table not in ('services', 'treatment_templates', 'room_types', 'pharmacy_items', 'lookup_values') then
    return;
  end if;
  execute format('update public.%I set usage_count = usage_count + 1, last_used_at = now() where id = $1', p_table)
    using p_id;
end;
$$;

-- Admin: items added on the fly that nobody has reviewed yet (newest first, keyset).
create function public.library_review_list(p_kind text default null, p_cursor text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  with pending as (
    select 'service' as kind, id, name as label, created_at, created_by from public.services
      where created_on_the_fly and reviewed_at is null and merged_into_id is null
    union all
    select 'treatment_template', id, name, created_at, created_by from public.treatment_templates
      where created_on_the_fly and reviewed_at is null and merged_into_id is null
    union all
    select 'room_type', id, name, created_at, created_by from public.room_types
      where created_on_the_fly and reviewed_at is null and merged_into_id is null
    union all
    select 'pharmacy_item', id, name, created_at, created_by from public.pharmacy_items
      where created_on_the_fly and reviewed_at is null and merged_into_id is null
    union all
    select kind, id, label, created_at, created_by from public.lookup_values
      where created_on_the_fly and reviewed_at is null and merged_into_id is null
  ), page as (
    select p.* from pending p
    where (p_kind is null or p.kind = p_kind)
      and (v_c is null or (p.created_at, p.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by p.created_at desc, p.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', p.kind, 'id', p.id, 'label', p.label,
           'created_at', p.created_at, 'created_by', s.full_name) order by p.created_at desc, p.id desc), '[]'::jsonb)
    into v_rows
  from page p left join public.staff s on s.id = p.created_by;

  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality x where x.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'created_at', v_rows -> (v_limit - 1) ->> 'id')::text end
  );
end;
$$;

create function public.library_mark_reviewed(p_kind text, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_spec record;
  v_count integer;
begin
  select * into v_spec from private.library_spec(p_kind);
  if v_spec.tbl is null or v_spec.tbl = 'doctors' then
    perform private.fail('invalid_input', 'unknown library kind');
  end if;
  execute format('update public.%I set reviewed_at = now(), reviewed_by = $1
                   where id = any ($2) and reviewed_at is null', v_spec.tbl)
    using v_admin, p_ids;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Admin: merge a duplicate into the item to keep. Every foreign key that points at the
-- library table is repointed (found from the catalog, so tables added in later phases are
-- covered automatically). A foreign key commented 'merge:keep' keeps its old reference
-- (e.g. finalized bill lines, which must never change).
create function public.library_merge(p_kind text, p_from uuid, p_into uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_spec record;
  r record;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
  v_ok integer;
begin
  select * into v_spec from private.library_spec(p_kind);
  if v_spec.tbl is null or v_spec.tbl = 'doctors' then
    perform private.fail('invalid_input', 'unknown library kind');
  end if;
  if p_from = p_into then
    perform private.fail('invalid_input', 'cannot merge an item into itself');
  end if;
  execute format('select count(*) from public.%I where id = any ($1) and merged_into_id is null
                    and ($2::text is null or %s)', v_spec.tbl,
                 case when v_spec.tbl = 'lookup_values' then 'kind = $2' else 'true' end)
    into v_ok using array[p_from, p_into], v_spec.lookup_kind;
  if v_ok <> 2 then
    perform private.fail('not_found');
  end if;
  perform set_config('app.reason', format('merged into %s', p_into), true);

  for r in
    select c.conrelid::regclass::text as tbl, a.attname::text as col, c.conname::text as con
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = format('public.%I', v_spec.tbl)::regclass
      and cardinality(c.conkey) = 1
      and a.attname <> 'merged_into_id'
      and coalesce(obj_description(c.oid, 'pg_constraint'), '') <> 'merge:keep'
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_into, p_from;
    exception when unique_violation then
      perform private.fail('merge_conflict', format('%s.%s already uses both items', r.tbl, r.col));
    end;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object(r.tbl || '.' || r.col, v_n);
    end if;
  end loop;

  execute format('update public.%I t set usage_count = t.usage_count + f.usage_count
                    from public.%I f where t.id = $1 and f.id = $2', v_spec.tbl, v_spec.tbl)
    using p_into, p_from;
  execute format('update public.%I set active = false, merged_into_id = $1, reviewed_at = coalesce(reviewed_at, now()),
                    reviewed_by = coalesce(reviewed_by, $3) where id = $2', v_spec.tbl)
    using p_into, p_from, v_admin;
  return jsonb_build_object('into', p_into, 'moved', v_moved);
end;
$$;

-- Admin audit viewer: newest first, keyset on id (ids only grow, so id order = time order).
create function public.audit_list(
  p_table text default null,
  p_row_id text default null,
  p_actor_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_cursor bigint default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'at', a.at, 'actor_id', a.actor_id, 'actor', s.full_name, 'table_name', a.table_name,
           'row_id', a.row_id, 'action', a.action, 'changes', a.changes, 'reason', a.reason)
         order by a.id desc), '[]'::jsonb)
    into v_rows
  from (
    select * from public.audit_log l
    where (p_cursor is null or l.id < p_cursor)
      and (p_table is null or l.table_name = p_table)
      and (p_row_id is null or l.row_id = p_row_id)
      and (p_actor_id is null or l.actor_id = p_actor_id)
      and (p_from is null or l.at >= p_from)
      and (p_to is null or l.at < p_to)
    order by l.id desc
    limit v_limit + 1
  ) a
  left join public.staff s on s.id = a.actor_id;

  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality x where x.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then (v_rows -> (v_limit - 1) ->> 'id') end
  );
end;
$$;

-- The clinic profile row: created by the admin's first save (no row exists on a new install).
create function public.save_clinic_profile(p_profile jsonb)
returns public.clinic_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.clinic_settings;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  insert into public.clinic_settings (
    branch_code, name, legal_name, gstin, llpin, address_lines, city, state, state_code, pincode,
    phones, email, website, logo_path, letterhead_qr_url, signatory_label, terms)
  values (
    'main', btrim(p_profile ->> 'name'), nullif(btrim(p_profile ->> 'legal_name'), ''),
    nullif(upper(btrim(p_profile ->> 'gstin')), ''), nullif(btrim(p_profile ->> 'llpin'), ''),
    coalesce(array(select btrim(x) from jsonb_array_elements_text(p_profile -> 'address_lines') x where btrim(x) <> ''), '{}'),
    nullif(btrim(p_profile ->> 'city'), ''), nullif(btrim(p_profile ->> 'state'), ''),
    nullif(btrim(p_profile ->> 'state_code'), ''), nullif(btrim(p_profile ->> 'pincode'), ''),
    coalesce(array(select btrim(x) from jsonb_array_elements_text(p_profile -> 'phones') x where btrim(x) <> ''), '{}'),
    nullif(btrim(p_profile ->> 'email'), ''), nullif(btrim(p_profile ->> 'website'), ''),
    nullif(p_profile ->> 'logo_path', ''), nullif(btrim(p_profile ->> 'letterhead_qr_url'), ''),
    coalesce(nullif(btrim(p_profile ->> 'signatory_label'), ''), 'Authorized Signatory'),
    coalesce(p_profile -> 'terms', '{}'::jsonb))
  on conflict (branch_code) do update set
    name = excluded.name, legal_name = excluded.legal_name, gstin = excluded.gstin, llpin = excluded.llpin,
    address_lines = excluded.address_lines, city = excluded.city, state = excluded.state,
    state_code = excluded.state_code, pincode = excluded.pincode, phones = excluded.phones,
    email = excluded.email, website = excluded.website, logo_path = excluded.logo_path,
    letterhead_qr_url = excluded.letterhead_qr_url, signatory_label = excluded.signatory_label,
    terms = excluded.terms
  returning * into v_row;
  return v_row;
exception
  when check_violation or not_null_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- Every login is a username + password (owner's rule): admins must give one.
create or replace function public.admin_create_staff(
  p_user_id uuid,
  p_role public.staff_role,
  p_full_name text,
  p_username text default null,
  p_email text default null,
  p_phone_e164 text default null
)
returns public.staff
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_row public.staff;
begin
  if v_username !~ '^[a-z0-9._-]{3,32}$' then
    perform private.fail('invalid_input', 'username');
  end if;
  insert into public.staff (id, role, full_name, username, email, phone_e164, created_by, updated_by)
  values (p_user_id, p_role, btrim(p_full_name), v_username,
          lower(nullif(btrim(p_email), '')), nullif(btrim(p_phone_e164), ''), v_admin, v_admin)
  returning * into v_row;
  return v_row;
exception
  when unique_violation then
    perform private.fail('duplicate', 'username');
end;
$$;

grant execute on function
  public.library_search(text, text, text, integer),
  public.library_create(text, jsonb, uuid),
  public.library_review_list(text, text, integer),
  public.library_mark_reviewed(text, uuid[]),
  public.library_merge(text, uuid, uuid),
  public.audit_list(text, text, uuid, timestamptz, timestamptz, bigint, integer),
  public.save_clinic_profile(jsonb)
to authenticated;
select private.lock_down_public_functions();
