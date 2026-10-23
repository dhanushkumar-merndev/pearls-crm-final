-- Pearl CRM — Phase 0 foundation (PLAN.md C1–C7)
-- Staff & roles, RLS helpers, login-token hook, audit trail, settings,
-- gap-free number series, private-file index, notifications, system tables.

------------------------------------------------------------------------------
-- Extensions and schemas
------------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Helpers, triggers and internal functions. Not exposed through the API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

------------------------------------------------------------------------------
-- Enums
------------------------------------------------------------------------------
create type public.staff_role as enum (
  'receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin'
);
create type public.theme_pref as enum ('dark', 'light', 'system');
create type public.series_key as enum (
  'uhid', 'ip_number', 'procedure_receipt', 'pharmacy_invoice', 'final_bill'
);
create type public.file_purpose as enum (
  'prescription', 'document', 'registration_form', 'patient_photo', 'call_recording',
  'visit_recording', 'voice_note', 'punch_photo', 'selfie', 'doctor_signature', 'pdf', 'thumbnail'
);
create type public.file_status as enum ('pending', 'uploaded', 'failed', 'archived', 'deleted');

------------------------------------------------------------------------------
-- Generic helpers
------------------------------------------------------------------------------

-- Raise a stable error code that the apps translate (packages/shared/src/errors.ts).
-- Deliberately VOLATILE: an immutable raiser can fire during query planning.
create function private.fail(p_code text, p_detail text default null)
returns void
language plpgsql
volatile
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

create function private.touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- IST wall-clock time for an instant (IST is fixed UTC+05:30, no DST).
create function private.ist(p_at timestamptz)
returns timestamp
language sql
immutable
parallel safe
as $$
  select (p_at at time zone 'UTC') + interval '5 hours 30 minutes';
$$;

-- Indian financial year label for an instant, decided in IST: '2026-27'.
create function private.fy_label(p_at timestamptz)
returns text
language sql
immutable
parallel safe
as $$
  select format('%s-%s', y, lpad(((y + 1) % 100)::text, 2, '0'))
  from (
    select case when extract(month from private.ist(p_at)) >= 4
                then extract(year from private.ist(p_at))::int
                else extract(year from private.ist(p_at))::int - 1 end as y
  ) t;
$$;

------------------------------------------------------------------------------
-- Staff
------------------------------------------------------------------------------
create table public.staff (
  id uuid primary key references auth.users (id) on delete restrict,
  role public.staff_role not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  username text unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  email text,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_last10 text generated always as (right(phone_e164, 10)) stored,
  active boolean not null default true,
  avatar_path text,
  theme public.theme_pref not null default 'dark',
  office_id uuid, -- FK to offices added in Phase 13 (BDM)
  bdm_start_anywhere boolean not null default false,
  recording_upload_override text check (recording_upload_override in ('sync_only', 'all_calls')),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (active or deactivated_at is not null)
);
create index staff_role_active on public.staff (role) where active;

create trigger staff_touch before update on public.staff
  for each row execute function private.touch_updated();

------------------------------------------------------------------------------
-- RLS helpers. They read the LIVE staff table, so deactivation and role
-- changes apply on the next request (not when the login token expires).
-- Use inside policies as (select private.my_role()) so Postgres runs them once.
------------------------------------------------------------------------------
create function private.my_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select s.role from public.staff s where s.id = auth.uid() and s.active;
$$;

create function private.my_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.staff s where s.id = auth.uid() and s.active;
$$;

create function private.has_role(variadic p_roles public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.role = any (p_roles) from public.staff s where s.id = auth.uid() and s.active),
    false
  );
$$;

-- For RPCs: returns the caller's staff id or raises not_signed_in / staff_inactive / not_allowed.
create function private.require_staff(p_roles public.staff_role[] default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
  v_active boolean;
begin
  if auth.uid() is null then
    perform private.fail('not_signed_in');
  end if;
  select s.role, s.active into v_role, v_active from public.staff s where s.id = auth.uid();
  if v_role is null then
    perform private.fail('not_allowed');
  end if;
  if not v_active then
    perform private.fail('staff_inactive');
  end if;
  if p_roles is not null and not (v_role = any (p_roles)) then
    perform private.fail('not_allowed');
  end if;
  return auth.uid();
end;
$$;

------------------------------------------------------------------------------
-- Login-token hook: adds app_role and staff_active claims for UI routing only.
------------------------------------------------------------------------------
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_role public.staff_role;
  v_active boolean;
begin
  select s.role, s.active into v_role, v_active
  from public.staff s
  where s.id = (event ->> 'user_id')::uuid;

  v_claims := jsonb_set(v_claims, '{app_role}', coalesce(to_jsonb(v_role::text), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{staff_active}', to_jsonb(coalesce(v_active, false)));
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.staff to supabase_auth_admin;

------------------------------------------------------------------------------
-- Audit trail (field-level). Attach with:
--   create trigger <t>_audit after insert or update or delete on public.<t>
--     for each row execute function private.audit_row();
-- RPCs that need a reason call: perform set_config('app.reason', p_reason, true);
------------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb not null default '{}'::jsonb,
  reason text,
  request_id text
);
create index audit_log_at on public.audit_log using brin (at);
create index audit_log_row on public.audit_log (table_name, row_id, at desc);
create index audit_log_actor on public.audit_log (actor_id, at desc);

create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_ignore text[] := array['updated_at', 'updated_by', 'created_at', 'created_by'];
  v_changes jsonb;
  v_headers text := nullif(current_setting('request.headers', true), '');
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_array(v_old -> n.key, n.value)), '{}'::jsonb)
      into v_changes
    from jsonb_each(v_new) n
    where n.key <> all (v_ignore)
      and n.value is distinct from (v_old -> n.key);
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_array(null, n.value)), '{}'::jsonb)
      into v_changes
    from jsonb_each(v_new) n
    where n.key <> all (v_ignore);
  else
    select coalesce(jsonb_object_agg(o.key, jsonb_build_array(o.value, null)), '{}'::jsonb)
      into v_changes
    from jsonb_each(v_old) o
    where o.key <> all (v_ignore);
  end if;

  insert into public.audit_log (actor_id, table_name, row_id, action, changes, reason, request_id)
  values (
    auth.uid(),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'section', v_old ->> 'section', '?'),
    lower(tg_op),
    v_changes,
    nullif(current_setting('app.reason', true), ''),
    case when v_headers is not null then v_headers::jsonb ->> 'x-request-id' end
  );
  return coalesce(new, old);
end;
$$;

create trigger staff_audit after insert or update or delete on public.staff
  for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- Clinic profile (one row now; branch_code keeps a second branch possible)
------------------------------------------------------------------------------
create table public.clinic_settings (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null unique default 'main',
  name text not null check (length(btrim(name)) between 1 and 200),
  legal_name text,
  gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  llpin text,
  address_lines text[] not null default '{}',
  city text,
  state text,
  state_code text check (state_code ~ '^[0-9]{2}$'),
  pincode text check (pincode ~ '^[1-9][0-9]{5}$'),
  phones text[] not null default '{}',
  email text,
  website text,
  logo_path text,
  letterhead_qr_url text,
  signatory_label text not null default 'Authorized Signatory',
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger clinic_settings_touch before update on public.clinic_settings
  for each row execute function private.touch_updated();
create trigger clinic_settings_audit after insert or update or delete on public.clinic_settings
  for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- App settings: one JSON document per section, validated by Zod in the apps
-- and versioned for optimistic locking (update_settings RPC).
------------------------------------------------------------------------------
create table public.app_settings (
  section text primary key check (section in (
    'ui', 'security', 'appointments', 'billing', 'pharmacy', 'sales', 'bdm', 'whatsapp',
    'meta', 'storage', 'notifications', 'registration_form'
  )),
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger app_settings_audit after insert or update or delete on public.app_settings
  for each row execute function private.audit_row();

-- Sections every signed-in staff member may read; the rest are admin-only.
create function private.is_public_settings_section(p_section text)
returns boolean
language sql
immutable
as $$
  select p_section in ('ui', 'security', 'appointments', 'billing', 'pharmacy', 'registration_form');
$$;

------------------------------------------------------------------------------
-- Number series: gap-free, concurrency-safe (row lock), per financial year.
------------------------------------------------------------------------------
create table public.number_series (
  id uuid primary key default gen_random_uuid(),
  series_key public.series_key not null,
  fy text not null check (fy = 'ALL' or fy ~ '^[0-9]{4}-[0-9]{2}$'),
  prefix text not null default '' check (length(prefix) <= 20),
  format text not null default '{prefix}/{fy}/{n}' check (position('{n}' in format) > 0),
  padding integer not null default 0 check (padding between 0 and 10),
  next_value bigint not null default 1 check (next_value >= 1),
  last_used bigint not null default 0 check (last_used >= 0 and last_used < next_value),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (series_key, fy)
);
create trigger number_series_touch before update on public.number_series
  for each row execute function private.touch_updated();
create trigger number_series_audit after insert or update or delete on public.number_series
  for each row execute function private.audit_row();

-- Which FY bucket a series uses. UHIDs never reset.
create function private.series_fy(p_key public.series_key, p_at timestamptz)
returns text
language sql
immutable
as $$
  select case when p_key = 'uhid' then 'ALL' else private.fy_label(p_at) end;
$$;

create function private.format_number(p_series public.number_series, p_n bigint)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(p_series.format,
    '{prefix}', p_series.prefix),
    '{fyfull}', p_series.fy),
    '{fy}', case when p_series.fy = 'ALL' then '' else right(p_series.fy, 5) end),
    '{n}', case when p_series.padding > length(p_n::text)
                then lpad(p_n::text, p_series.padding, '0')
                else p_n::text end);
$$;

-- Takes the next number. MUST run inside the transaction that uses it (e.g. finalize):
-- if that transaction rolls back, the number is returned — so there are never gaps.
-- A new financial year starts at 1, copying prefix/format from the latest year.
create function private.take_number(p_key public.series_key, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fy text := private.series_fy(p_key, p_at);
  v_series public.number_series;
begin
  update public.number_series
     set next_value = next_value + 1, last_used = next_value
   where series_key = p_key and fy = v_fy
  returning * into v_series;

  if not found then
    insert into public.number_series (series_key, fy, prefix, format, padding)
    select p_key, v_fy,
           coalesce(latest.prefix, ''),
           coalesce(latest.format, case when p_key = 'uhid' then '{prefix}{n}' else '{prefix}/{fy}/{n}' end),
           coalesce(latest.padding, 0)
    from (select 1) one
    left join lateral (
      select ns.prefix, ns.format, ns.padding
      from public.number_series ns
      where ns.series_key = p_key
      order by ns.fy desc
      limit 1
    ) latest on true
    on conflict (series_key, fy) do nothing;

    update public.number_series
       set next_value = next_value + 1, last_used = next_value
     where series_key = p_key and fy = v_fy
    returning * into v_series;
  end if;

  return private.format_number(v_series, v_series.last_used);
end;
$$;

------------------------------------------------------------------------------
-- Private files index (objects live in Tigris; this table is the only index —
-- the bucket is never LISTed). Links to patients/leads get FKs in later phases.
------------------------------------------------------------------------------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  object_key text not null unique,
  purpose public.file_purpose not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer,
  height integer,
  page_count integer,
  duration_s integer,
  status public.file_status not null default 'pending',
  owner_staff_id uuid not null references public.staff (id),
  patient_id uuid,
  lead_id uuid,
  linked_table text,
  linked_id uuid,
  thumbnail_file_id uuid references public.files (id),
  uploaded_at timestamptz,
  archived_at timestamptz,
  backup_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index files_patient on public.files (patient_id, created_at desc) where patient_id is not null;
create index files_sha on public.files (sha256) where sha256 is not null;
create index files_purpose_status on public.files (purpose, status, created_at);
create index files_owner on public.files (owner_staff_id, created_at desc);
create trigger files_touch before update on public.files
  for each row execute function private.touch_updated();

-- Upload rules per purpose: who may upload, allowed types, size cap (PLAN.md 14.1).
create function private.file_rule(p_purpose public.file_purpose)
returns table (roles public.staff_role[], mimes text[], max_bytes bigint)
language sql
immutable
as $$
  select r.roles, r.mimes, r.max_bytes
  from (values
    ('prescription'::public.file_purpose, array['receptionist','admin']::public.staff_role[], array['image/webp','image/jpeg','application/pdf'], 3145728::bigint),
    ('document',          array['receptionist','admin']::public.staff_role[], array['image/webp','image/jpeg','image/png','application/pdf'], 3145728),
    ('registration_form', array['receptionist','admin']::public.staff_role[], array['image/webp','image/jpeg','application/pdf'], 3145728),
    ('patient_photo',     array['receptionist','admin']::public.staff_role[], array['image/webp','image/jpeg'], 512000),
    ('call_recording',    array['sales_executive','sales_manager','admin']::public.staff_role[], array['audio/ogg','audio/mp4'], 3145728),
    ('voice_note',        array['sales_executive','sales_manager','bdm','admin']::public.staff_role[], array['audio/ogg','audio/mp4'], 1048576),
    ('visit_recording',   array['bdm','admin']::public.staff_role[], array['audio/ogg','audio/mp4'], 8388608),
    ('punch_photo',       array['bdm','admin']::public.staff_role[], array['image/webp','image/jpeg'], 512000),
    ('selfie',            array['bdm','admin']::public.staff_role[], array['image/webp','image/jpeg'], 512000),
    ('doctor_signature',  array['admin']::public.staff_role[], array['image/png','image/webp'], 307200),
    ('pdf',               array['receptionist','admin']::public.staff_role[], array['application/pdf'], 5242880),
    ('thumbnail',         array['receptionist','sales_executive','sales_manager','bdm','admin']::public.staff_role[], array['image/webp','image/jpeg'], 102400)
  ) as r (purpose, roles, mimes, max_bytes)
  where r.purpose = p_purpose;
$$;

------------------------------------------------------------------------------
-- Notifications, devices, system tables
------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.staff (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+$'),
  title text not null,
  body text,
  link text,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox on public.notifications (recipient_id, created_at desc);
create index notifications_unread on public.notifications (recipient_id) where read_at is null;

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android', 'web')),
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index device_tokens_staff on public.device_tokens (staff_id);

create table public.idempotency_keys (
  key uuid primary key,
  staff_id uuid references public.staff (id) on delete cascade,
  fn text not null,
  response jsonb,
  created_at timestamptz not null default now()
);
create index idempotency_keys_created on public.idempotency_keys (created_at);

create table public.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  staff_id uuid references public.staff (id) on delete set null,
  app text not null check (app in ('web', 'android')),
  app_version text,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb
);
create index client_errors_at on public.client_errors using brin (at);
create index client_errors_staff on public.client_errors (staff_id, at desc);

create table public.integration_status (
  integration text primary key check (integration in ('whatsapp', 'meta_leads', 'brevo', 'ors', 'fcm', 'tigris')),
  state text not null default 'unknown' check (state in ('ok', 'error', 'unknown', 'off')),
  last_ok_at timestamptz,
  last_error text,
  checked_at timestamptz
);

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb not null default '{}'::jsonb
);
create index job_runs_job on public.job_runs (job, started_at desc);

create table public.usage_counters (
  month date not null check (extract(day from month) = 1),
  metric text not null check (metric ~ '^[a-z_]+$'),
  value bigint not null default 0,
  primary key (month, metric)
);

create function private.bump_usage(p_metric text, p_by bigint default 1)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.usage_counters (month, metric, value)
  values (date_trunc('month', private.ist(now()))::date, p_metric, p_by)
  on conflict (month, metric) do update set value = public.usage_counters.value + excluded.value;
$$;

------------------------------------------------------------------------------
-- Row Level Security
------------------------------------------------------------------------------
alter table public.staff enable row level security;
alter table public.audit_log enable row level security;
alter table public.clinic_settings enable row level security;
alter table public.app_settings enable row level security;
alter table public.number_series enable row level security;
alter table public.files enable row level security;
alter table public.notifications enable row level security;
alter table public.device_tokens enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.client_errors enable row level security;
alter table public.integration_status enable row level security;
alter table public.job_runs enable row level security;
alter table public.usage_counters enable row level security;

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Apps write through RPCs. Direct writes are allowed only where a policy says so.
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant update on public.clinic_settings to authenticated; -- admin only, via policy

-- staff: everyone reads their own row; admin reads all. Changes via admin RPCs.
create policy staff_select on public.staff for select to authenticated
  using (id = (select auth.uid()) or (select private.has_role('admin')));
create policy staff_token_hook on public.staff for select to supabase_auth_admin
  using (true);

-- clinic profile: every active staff member reads; admin edits.
create policy clinic_settings_select on public.clinic_settings for select to authenticated
  using ((select private.my_role()) is not null);
create policy clinic_settings_update on public.clinic_settings for update to authenticated
  using ((select private.has_role('admin')))
  with check ((select private.has_role('admin')));

-- app settings: public sections for all active staff, the rest admin only.
create policy app_settings_select on public.app_settings for select to authenticated
  using (
    (select private.has_role('admin'))
    or ((select private.my_role()) is not null and private.is_public_settings_section(section))
  );

-- number series, audit log, system tables: admin read only.
create policy number_series_select on public.number_series for select to authenticated
  using ((select private.has_role('admin')));
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select private.has_role('admin')));
create policy client_errors_select on public.client_errors for select to authenticated
  using ((select private.has_role('admin')));
create policy integration_status_select on public.integration_status for select to authenticated
  using ((select private.has_role('admin')));
create policy job_runs_select on public.job_runs for select to authenticated
  using ((select private.has_role('admin')));
create policy usage_counters_select on public.usage_counters for select to authenticated
  using ((select private.has_role('admin')));

-- files: owner and admin. Later phases widen this per linked record (patient, lead…).
create policy files_select on public.files for select to authenticated
  using (
    (select private.has_role('admin'))
    or (owner_staff_id = (select private.my_staff_id()))
  );

-- notifications & devices: own rows only.
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select private.my_staff_id()));
create policy device_tokens_select on public.device_tokens for select to authenticated
  using (staff_id = (select private.my_staff_id()));

-- idempotency keys: never read directly.
create policy idempotency_keys_none on public.idempotency_keys for select to authenticated
  using (false);

------------------------------------------------------------------------------
-- RPCs (all security definer, role-checked, search_path locked)
------------------------------------------------------------------------------

-- Current user's profile + what the shell needs.
create function public.me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
  v_staff public.staff;
  v_clinic public.clinic_settings;
begin
  select * into v_staff from public.staff where id = v_id;
  select * into v_clinic from public.clinic_settings where branch_code = 'main';
  return jsonb_build_object(
    'id', v_staff.id,
    'role', v_staff.role,
    'full_name', v_staff.full_name,
    'username', v_staff.username,
    'email', v_staff.email,
    'avatar_path', v_staff.avatar_path,
    'theme', v_staff.theme,
    'clinic', jsonb_build_object('name', v_clinic.name, 'logo_path', v_clinic.logo_path)
  );
end;
$$;

-- Directory of colleagues (names for dropdowns, assignment, chips).
create function public.staff_directory(p_include_inactive boolean default false)
returns table (id uuid, full_name text, role public.staff_role, active boolean, avatar_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
    select s.id, s.full_name, s.role, s.active, s.avatar_path
    from public.staff s
    where s.active or (p_include_inactive and private.has_role('admin'))
    order by s.full_name;
end;
$$;

create function public.set_my_theme(p_theme public.theme_pref)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
begin
  update public.staff set theme = p_theme where id = v_id;
end;
$$;

-- Admin creates the staff row after the Edge Function created the login (auth user).
create function public.admin_create_staff(
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
  v_row public.staff;
begin
  insert into public.staff (id, role, full_name, username, email, phone_e164, created_by, updated_by)
  values (p_user_id, p_role, btrim(p_full_name), lower(nullif(btrim(p_username), '')),
          lower(nullif(btrim(p_email), '')), nullif(btrim(p_phone_e164), ''), v_admin, v_admin)
  returning * into v_row;
  return v_row;
end;
$$;

-- Admin changes role / name / phone / active. Deactivation takes effect on the next request.
create function public.admin_update_staff(
  p_staff_id uuid,
  p_patch jsonb,
  p_reason text default null
)
returns public.staff
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_row public.staff;
  v_active boolean;
begin
  if p_staff_id = v_admin and (p_patch ? 'active' or p_patch ? 'role') then
    perform private.fail('not_allowed', 'admins cannot change their own role or deactivate themselves');
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  v_active := coalesce((p_patch ->> 'active')::boolean, (select active from public.staff where id = p_staff_id));

  update public.staff s set
    role = coalesce((p_patch ->> 'role')::public.staff_role, s.role),
    full_name = coalesce(nullif(btrim(p_patch ->> 'full_name'), ''), s.full_name),
    phone_e164 = case when p_patch ? 'phone_e164' then nullif(btrim(p_patch ->> 'phone_e164'), '') else s.phone_e164 end,
    bdm_start_anywhere = coalesce((p_patch ->> 'bdm_start_anywhere')::boolean, s.bdm_start_anywhere),
    active = v_active,
    deactivated_at = case when v_active then null else coalesce(s.deactivated_at, now()) end
  where s.id = p_staff_id
  returning * into v_row;

  if not found then
    perform private.fail('not_found');
  end if;
  return v_row;
end;
$$;

-- Service-role only: sign a user out everywhere (used when deactivating).
create function public.admin_revoke_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user_id;
$$;
revoke execute on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to service_role;

-- Settings: replace one section's JSON with optimistic locking.
create function public.update_settings(p_section text, p_value jsonb, p_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if jsonb_typeof(p_value) is distinct from 'object' then
    perform private.fail('invalid_input', 'settings value must be a JSON object');
  end if;

  insert into public.app_settings (section, value, version, updated_by)
  values (p_section, p_value, 1, auth.uid())
  on conflict (section) do update
    set value = excluded.value,
        version = public.app_settings.version + 1,
        updated_at = now(),
        updated_by = auth.uid()
    where public.app_settings.version = p_version
  returning version into v_version;

  if v_version is null then
    perform private.fail('stale_version');
  end if;
  return v_version;
exception
  when check_violation then
    perform private.fail('unknown_settings_section');
end;
$$;

-- Number series admin. Never allows going back to an already-used number.
create function public.set_number_series(
  p_key public.series_key,
  p_fy text,
  p_prefix text,
  p_format text,
  p_next_value bigint,
  p_padding integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.number_series;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if p_key = 'uhid' and p_fy <> 'ALL' then
    perform private.fail('invalid_input', 'UHID series uses fy = ALL');
  end if;

  select * into v_row from public.number_series where series_key = p_key and fy = p_fy for update;
  if found and p_next_value <= v_row.last_used then
    perform private.fail('series_below_used', format('last used number is %s', v_row.last_used));
  end if;

  insert into public.number_series (series_key, fy, prefix, format, padding, next_value)
  values (p_key, p_fy, coalesce(p_prefix, ''), p_format, coalesce(p_padding, 0), p_next_value)
  on conflict (series_key, fy) do update
    set prefix = excluded.prefix, format = excluded.format,
        padding = excluded.padding, next_value = excluded.next_value
  returning * into v_row;

  return jsonb_build_object(
    'series_key', v_row.series_key, 'fy', v_row.fy,
    'next_preview', private.format_number(v_row, v_row.next_value)
  );
end;
$$;

-- What the next number will look like (does not consume it).
create function public.preview_next_number(p_key public.series_key)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.number_series;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  select * into v_row from public.number_series
   where series_key = p_key and fy = private.series_fy(p_key, now());
  if not found then
    return null;
  end if;
  return private.format_number(v_row, v_row.next_value);
end;
$$;

-- Notifications: mark some (or all) of my notifications as read.
create function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
  v_count integer;
begin
  update public.notifications
     set read_at = now()
   where recipient_id = v_id
     and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.register_device(p_token text, p_platform text, p_app_version text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
begin
  insert into public.device_tokens (staff_id, token, platform, app_version)
  values (v_id, p_token, p_platform, p_app_version)
  on conflict (token) do update
    set staff_id = excluded.staff_id, platform = excluded.platform,
        app_version = excluded.app_version, last_seen_at = now();
end;
$$;

-- Apps report crashes here. Max 30 per person per 10 minutes.
create function public.report_client_error(
  p_app text,
  p_message text,
  p_stack text default null,
  p_context jsonb default '{}'::jsonb,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
begin
  if (select count(*) from public.client_errors
       where staff_id = v_id and at > now() - interval '10 minutes') >= 30 then
    perform private.fail('rate_limited');
  end if;
  insert into public.client_errors (staff_id, app, app_version, message, stack, context)
  values (v_id, p_app, left(p_app_version, 40), left(p_message, 2000), left(p_stack, 8000),
          coalesce(p_context, '{}'::jsonb));
end;
$$;

-- Files: step 1 of an upload. Checks role, type and size; creates the pending row.
-- The files-sign Edge Function then returns a short-lived upload link for object_key.
create function public.files_begin_upload(
  p_purpose public.file_purpose,
  p_mime text,
  p_size_bytes bigint,
  p_sha256 text default null,
  p_link jsonb default '{}'::jsonb,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
  v_role public.staff_role := private.my_role();
  v_rule record;
  v_file_id uuid := coalesce(p_client_id, gen_random_uuid());
  v_ext text;
  v_key text;
  v_existing public.files;
begin
  select * into v_rule from private.file_rule(p_purpose);
  if not (v_role = any (v_rule.roles)) then
    perform private.fail('not_allowed');
  end if;
  if not (p_mime = any (v_rule.mimes)) then
    perform private.fail('file_type_not_allowed');
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_rule.max_bytes then
    perform private.fail('file_too_large', format('limit %s bytes', v_rule.max_bytes));
  end if;

  -- Same client id again (a retry): hand back the same pending upload.
  select * into v_existing from public.files where id = v_file_id;
  if found then
    if v_existing.owner_staff_id <> v_id then
      perform private.fail('not_allowed');
    end if;
    return jsonb_build_object('file_id', v_existing.id, 'object_key', v_existing.object_key,
                              'bucket', v_existing.bucket, 'status', v_existing.status);
  end if;

  v_ext := case p_mime
    when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'application/pdf' then 'pdf' when 'audio/ogg' then 'ogg' when 'audio/mp4' then 'm4a'
  end;
  -- No names or phone numbers in keys: purpose/yyyy/mm/<uuid>.<ext>
  v_key := format('%s/%s/%s.%s', p_purpose, to_char(private.ist(now()), 'YYYY/MM'), v_file_id, v_ext);

  insert into public.files (id, bucket, object_key, purpose, mime, size_bytes, sha256,
                            owner_staff_id, patient_id, lead_id, linked_table, linked_id)
  values (v_file_id, 'private', v_key, p_purpose, p_mime, p_size_bytes, lower(p_sha256), v_id,
          (p_link ->> 'patient_id')::uuid, (p_link ->> 'lead_id')::uuid,
          p_link ->> 'linked_table', (p_link ->> 'linked_id')::uuid);

  return jsonb_build_object('file_id', v_file_id, 'object_key', v_key, 'bucket', 'private',
                            'status', 'pending');
end;
$$;

-- Files: step 3 — the Edge Function verified the object (size + real type).
create function public.files_mark_uploaded(p_file_id uuid, p_size_bytes bigint)
returns public.files
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
  v_row public.files;
  v_was public.file_status;
begin
  select status into v_was from public.files
   where id = p_file_id and owner_staff_id = v_id
   for update;
  if not found or v_was not in ('pending', 'uploaded') then
    perform private.fail('not_found');
  end if;

  update public.files
     set status = 'uploaded', uploaded_at = coalesce(uploaded_at, now()), size_bytes = p_size_bytes
   where id = p_file_id
  returning * into v_row;

  if v_was = 'pending' then
    perform private.bump_usage('tigris_writes');
  end if;
  return v_row;
end;
$$;

-- Files: the Edge Function found the object missing or not the declared type.
create function public.files_mark_failed(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.require_staff();
begin
  update public.files set status = 'failed'
   where id = p_file_id and owner_staff_id = v_id and status = 'pending';
  if not found then
    perform private.fail('not_found');
  end if;
end;
$$;

-- Files the caller may view (RLS decides). The Edge Function signs view links only for these.
create function public.files_viewable(p_ids uuid[])
returns table (id uuid, object_key text, bucket text, mime text)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.id, f.object_key, f.bucket, f.mime
  from public.files f
  where f.id = any (p_ids) and f.status = 'uploaded';
$$;

------------------------------------------------------------------------------
-- Function privileges: RPCs are callable by signed-in staff only.
------------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.me(),
  public.staff_directory(boolean),
  public.set_my_theme(public.theme_pref),
  public.admin_create_staff(uuid, public.staff_role, text, text, text, text),
  public.admin_update_staff(uuid, jsonb, text),
  public.update_settings(text, jsonb, integer),
  public.set_number_series(public.series_key, text, text, text, bigint, integer),
  public.preview_next_number(public.series_key),
  public.mark_notifications_read(uuid[]),
  public.register_device(text, text, text),
  public.report_client_error(text, text, text, jsonb, text),
  public.files_begin_upload(public.file_purpose, text, bigint, text, jsonb, uuid),
  public.files_mark_uploaded(uuid, bigint),
  public.files_mark_failed(uuid),
  public.files_viewable(uuid[])
to authenticated;
-- The token hook must stay callable by the auth server (revoke above removed public).
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- The ONE function logged-out visitors may call: the login page shows the clinic's
-- name and logo (nothing else). The daily keep-alive also calls it.
create function public.public_branding()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('name', c.name, 'logo_path', c.logo_path)
       from public.clinic_settings c where c.branch_code = 'main'),
    '{}'::jsonb);
$$;
revoke execute on function public.public_branding() from public;
grant execute on function public.public_branding() to anon, authenticated;

-- New functions in public are not callable by anon unless granted explicitly.
alter default privileges in schema public revoke execute on functions from public, anon;
-- New tables: anon gets nothing, signed-in users get no direct writes (grant per table if needed).
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from authenticated;

-- Internal functions: only the RLS helpers are callable by signed-in users.
revoke execute on all functions in schema private from public;
alter default privileges in schema private revoke execute on functions from public;
grant execute on function
  private.my_role(),
  private.my_staff_id(),
  private.has_role(public.staff_role[]),
  private.is_public_settings_section(text)
to authenticated;

------------------------------------------------------------------------------
-- Realtime: the web bell listens to notifications.
------------------------------------------------------------------------------
alter publication supabase_realtime add table public.notifications;
