-- Pearl CRM — Phase 2: patients (PLAN.md C3 "Patients", D2 "Patients and registration")
-- Registration with duplicate decisions (new / update chosen fields / family), gap-free
-- UHIDs, QR self-registration requests, documents, global search, patient file,
-- admin merge (moves rows from every linked table), DocPulse patient import.

create type public.gender as enum ('female', 'male', 'other', 'unknown');

------------------------------------------------------------------------------
-- Patients
------------------------------------------------------------------------------
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  uhid text not null unique check (length(uhid) between 1 and 40),
  title text check (title in ('Mr', 'Mrs', 'Ms', 'Miss', 'Master', 'Baby', 'Dr')),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  gender public.gender not null default 'unknown',
  dob date check (dob > '1900-01-01'),
  dob_estimated boolean not null default false, -- only an age was given
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_last10 text generated always as (right(phone_e164, 10)) stored,
  whatsapp_e164 text check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_last10 text generated always as (right(whatsapp_e164, 10)) stored,
  alt_phone_e164 text check (alt_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  alt_phone_last10 text generated always as (right(alt_phone_e164, 10)) stored,
  email text check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text check (length(address) <= 500),
  area text check (length(area) <= 120),
  city text check (length(city) <= 80),
  pincode text check (pincode ~ '^[1-9][0-9]{5}$'),
  attender_name text check (length(attender_name) <= 120),
  attender_relation_id uuid references public.lookup_values (id),
  attender_phone_e164 text check (attender_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies text[] not null default '{}',
  conditions text[] not null default '{}',
  current_medicines text check (length(current_medicines) <= 2000),
  previous_surgeries text check (length(previous_surgeries) <= 2000),
  chief_complaints text check (length(chief_complaints) <= 2000),
  complaint_since text check (length(complaint_since) <= 120),
  heard_from_id uuid references public.lookup_values (id),
  referred_by_text text check (length(referred_by_text) <= 120),
  lead_id uuid, -- FK added in Phase 9
  preferred_language text check (length(preferred_language) <= 40),
  occupation text check (length(occupation) <= 120),
  id_proof_type text check (length(id_proof_type) <= 40),
  id_proof_number text check (length(id_proof_number) <= 40),
  photo_file_id uuid references public.files (id),
  -- {"treatment": {"given": true, "at": "...", "by": "<staff id>", "method": "paper"}, "whatsapp": {...}, ...}
  consents jsonb not null default '{}'::jsonb check (jsonb_typeof(consents) = 'object'),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  family_group_id uuid,
  tags text[] not null default '{}',
  wa_mode text not null default 'auto' check (wa_mode in ('auto', 'manual')),
  notes text check (length(notes) <= 4000),
  merged_into_id uuid references public.patients (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
-- Phone is NOT unique: families share numbers.
create index patients_phone on public.patients (phone_last10) where merged_into_id is null;
create index patients_whatsapp on public.patients (whatsapp_last10) where merged_into_id is null and whatsapp_last10 is not null;
create index patients_alt_phone on public.patients (alt_phone_last10) where merged_into_id is null and alt_phone_last10 is not null;
create index patients_name_trgm on public.patients using gin (full_name extensions.gin_trgm_ops);
-- "last few digits" phone search (LIKE '%1234') without scanning every patient.
create index patients_phone_trgm on public.patients using gin (phone_last10 extensions.gin_trgm_ops);
create index patients_uhid_prefix on public.patients (lower(uhid) text_pattern_ops);
create index patients_family on public.patients (family_group_id) where family_group_id is not null;
create index patients_recent on public.patients (created_at desc, id desc) where merged_into_id is null;
create trigger patients_touch before update on public.patients
  for each row execute function private.touch_updated();
create trigger patients_audit after insert or update or delete on public.patients
  for each row execute function private.audit_row();

alter table public.files
  add constraint files_patient_fk foreign key (patient_id) references public.patients (id);

------------------------------------------------------------------------------
-- Public links (QR self-registration, phone scanning). Only a hash of the token
-- is stored; the token itself is shown once, inside the QR.
------------------------------------------------------------------------------
create table public.public_links (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('self_registration', 'phone_scan')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  patient_id uuid references public.patients (id),
  created_by uuid references public.staff (id),
  expires_at timestamptz not null,
  max_uses integer check (max_uses > 0),
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
create index public_links_expiry on public.public_links (expires_at);

create table public.registration_requests (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references public.public_links (id),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  full_name text not null,
  phone_last10 text,
  status text not null default 'pending' check (status in ('pending', 'created', 'updated', 'family', 'discarded')),
  patient_id uuid references public.patients (id),
  reviewed_by uuid references public.staff (id),
  reviewed_at timestamptz,
  discard_reason text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index registration_requests_pending on public.registration_requests (created_at desc, id desc) where status = 'pending';
create index registration_requests_ip on public.registration_requests (ip_hash, created_at) where ip_hash is not null;

create table public.patient_merges (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.patients (id),
  into_id uuid not null references public.patients (id),
  moved jsonb not null default '{}'::jsonb,
  merged_by uuid references public.staff (id),
  merged_at timestamptz not null default now(),
  reason text not null
);
create index patient_merges_into on public.patient_merges (into_id);
-- These two must keep pointing at the original rows after a merge.
comment on constraint patient_merges_from_id_fkey on public.patient_merges is 'merge:keep';
comment on constraint patient_merges_into_id_fkey on public.patient_merges is 'merge:keep';
comment on constraint patients_merged_into_id_fkey on public.patients is 'merge:keep';

------------------------------------------------------------------------------
-- Documents (scans, PDFs). Visit / session / admission links get FKs in Phases 3–7.
------------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  kind_id uuid references public.lookup_values (id),
  title text not null check (length(btrim(title)) between 1 and 200),
  doc_date date not null default (private.ist(now()))::date,
  visit_id uuid,
  session_id uuid,
  admission_id uuid,
  doctor_id uuid references public.doctors (id),
  file_id uuid not null references public.files (id),
  thumbnail_file_id uuid references public.files (id),
  page_count integer check (page_count between 1 and 200),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index documents_patient on public.documents (patient_id, doc_date desc, id desc) where not archived;
create index documents_file on public.documents (file_id);
create trigger documents_touch before update on public.documents
  for each row execute function private.touch_updated();
create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function private.audit_row();

------------------------------------------------------------------------------
-- RLS: reception and admin read patients and their documents. Writes via RPCs.
-- (Sales see patient details only through lead RPCs in Phase 9.)
------------------------------------------------------------------------------
alter table public.patients enable row level security;
alter table public.public_links enable row level security;
alter table public.registration_requests enable row level security;
alter table public.patient_merges enable row level security;
alter table public.documents enable row level security;
grant select on public.patients, public.registration_requests, public.patient_merges, public.documents, public.public_links
  to authenticated;

create policy patients_select on public.patients for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy registration_requests_select on public.registration_requests for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy documents_select on public.documents for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy patient_merges_select on public.patient_merges for select to authenticated
  using ((select private.has_role('admin')));
create policy public_links_none on public.public_links for select to authenticated
  using (false);

-- Files: reception may also see files that belong to a patient.
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    (select private.has_role('admin'))
    or owner_staff_id = (select private.my_staff_id())
    or (patient_id is not null and (select private.has_role('receptionist'))
        and purpose in ('prescription', 'document', 'registration_form', 'patient_photo', 'pdf', 'thumbnail'))
  );

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
create function private.age_years(p_dob date)
returns integer
language sql
stable
as $$
  select case when p_dob is null then null
              else extract(year from age((private.ist(now()))::date, p_dob))::int end;
$$;

-- Turns a registration payload into patient columns. Unknown keys are ignored;
-- bad values raise invalid_input with the field name.
create function private.patient_fields(p jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v jsonb := '{}'::jsonb;
  k text;
  v_age integer;
  text_keys text[] := array['title', 'email', 'address', 'area', 'city', 'pincode', 'attender_name',
    'blood_group', 'current_medicines', 'previous_surgeries', 'chief_complaints', 'complaint_since',
    'referred_by_text', 'preferred_language', 'occupation', 'id_proof_type', 'id_proof_number', 'notes', 'wa_mode'];
  phone_keys text[] := array['phone_e164', 'whatsapp_e164', 'alt_phone_e164', 'attender_phone_e164'];
begin
  if p ? 'full_name' then
    if length(btrim(coalesce(p ->> 'full_name', ''))) = 0 then
      perform private.fail('invalid_input', 'full_name');
    end if;
    v := v || jsonb_build_object('full_name', regexp_replace(btrim(p ->> 'full_name'), '\s+', ' ', 'g'));
  end if;
  foreach k in array text_keys loop
    if p ? k then
      v := v || jsonb_build_object(k, nullif(btrim(coalesce(p ->> k, '')), ''));
    end if;
  end loop;
  foreach k in array phone_keys loop
    if p ? k then
      if nullif(p ->> k, '') is not null and (p ->> k) !~ '^\+[1-9][0-9]{7,14}$' then
        perform private.fail('invalid_input', k);
      end if;
      v := v || jsonb_build_object(k, nullif(p ->> k, ''));
    end if;
  end loop;
  if p ? 'gender' then
    v := v || jsonb_build_object('gender', coalesce(nullif(p ->> 'gender', ''), 'unknown'));
  end if;
  if p ? 'dob' then
    v := v || jsonb_build_object('dob', nullif(p ->> 'dob', ''), 'dob_estimated', false);
  elsif p ? 'age_years' and nullif(p ->> 'age_years', '') is not null then
    v_age := (p ->> 'age_years')::int;
    if v_age < 0 or v_age > 120 then
      perform private.fail('invalid_input', 'age_years');
    end if;
    -- Only an age: count from 1 July of the birth year (middle of the year), flagged as estimated.
    v := v || jsonb_build_object('dob', make_date(extract(year from private.ist(now()))::int - v_age, 7, 1),
                                 'dob_estimated', true);
  end if;
  foreach k in array array['allergies', 'conditions', 'tags'] loop
    if p ? k then
      v := v || jsonb_build_object(k, coalesce((
        select jsonb_agg(distinct btrim(x)) from jsonb_array_elements_text(p -> k) x where btrim(x) <> ''), '[]'::jsonb));
    end if;
  end loop;
  foreach k in array array['attender_relation_id', 'heard_from_id', 'photo_file_id'] loop
    if p ? k then
      v := v || jsonb_build_object(k, nullif(p ->> k, ''));
    end if;
  end loop;
  if p ? 'consents' then
    v := v || jsonb_build_object('consents', coalesce(p -> 'consents', '{}'::jsonb));
  end if;
  if p ? 'custom_fields' then
    v := v || jsonb_build_object('custom_fields', coalesce(p -> 'custom_fields', '{}'::jsonb));
  end if;
  return v;
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    perform private.fail('invalid_input', 'date or number');
end;
$$;

-- Writes the given columns onto one patient row (only keys present in p_fields).
create function private.patient_apply(p_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_fields = '{}'::jsonb then
    return;
  end if;
  update public.patients t set
    title = case when p_fields ? 'title' then p_fields ->> 'title' else t.title end,
    full_name = case when p_fields ? 'full_name' then p_fields ->> 'full_name' else t.full_name end,
    gender = case when p_fields ? 'gender' then (p_fields ->> 'gender')::public.gender else t.gender end,
    dob = case when p_fields ? 'dob' then (p_fields ->> 'dob')::date else t.dob end,
    dob_estimated = case when p_fields ? 'dob_estimated' then (p_fields ->> 'dob_estimated')::boolean else t.dob_estimated end,
    phone_e164 = case when p_fields ? 'phone_e164' then p_fields ->> 'phone_e164' else t.phone_e164 end,
    whatsapp_e164 = case when p_fields ? 'whatsapp_e164' then p_fields ->> 'whatsapp_e164' else t.whatsapp_e164 end,
    alt_phone_e164 = case when p_fields ? 'alt_phone_e164' then p_fields ->> 'alt_phone_e164' else t.alt_phone_e164 end,
    email = case when p_fields ? 'email' then lower(p_fields ->> 'email') else t.email end,
    address = case when p_fields ? 'address' then p_fields ->> 'address' else t.address end,
    area = case when p_fields ? 'area' then p_fields ->> 'area' else t.area end,
    city = case when p_fields ? 'city' then p_fields ->> 'city' else t.city end,
    pincode = case when p_fields ? 'pincode' then p_fields ->> 'pincode' else t.pincode end,
    attender_name = case when p_fields ? 'attender_name' then p_fields ->> 'attender_name' else t.attender_name end,
    attender_relation_id = case when p_fields ? 'attender_relation_id' then (p_fields ->> 'attender_relation_id')::uuid else t.attender_relation_id end,
    attender_phone_e164 = case when p_fields ? 'attender_phone_e164' then p_fields ->> 'attender_phone_e164' else t.attender_phone_e164 end,
    blood_group = case when p_fields ? 'blood_group' then p_fields ->> 'blood_group' else t.blood_group end,
    allergies = case when p_fields ? 'allergies' then array(select jsonb_array_elements_text(p_fields -> 'allergies')) else t.allergies end,
    conditions = case when p_fields ? 'conditions' then array(select jsonb_array_elements_text(p_fields -> 'conditions')) else t.conditions end,
    current_medicines = case when p_fields ? 'current_medicines' then p_fields ->> 'current_medicines' else t.current_medicines end,
    previous_surgeries = case when p_fields ? 'previous_surgeries' then p_fields ->> 'previous_surgeries' else t.previous_surgeries end,
    chief_complaints = case when p_fields ? 'chief_complaints' then p_fields ->> 'chief_complaints' else t.chief_complaints end,
    complaint_since = case when p_fields ? 'complaint_since' then p_fields ->> 'complaint_since' else t.complaint_since end,
    heard_from_id = case when p_fields ? 'heard_from_id' then (p_fields ->> 'heard_from_id')::uuid else t.heard_from_id end,
    referred_by_text = case when p_fields ? 'referred_by_text' then p_fields ->> 'referred_by_text' else t.referred_by_text end,
    preferred_language = case when p_fields ? 'preferred_language' then p_fields ->> 'preferred_language' else t.preferred_language end,
    occupation = case when p_fields ? 'occupation' then p_fields ->> 'occupation' else t.occupation end,
    id_proof_type = case when p_fields ? 'id_proof_type' then p_fields ->> 'id_proof_type' else t.id_proof_type end,
    id_proof_number = case when p_fields ? 'id_proof_number' then p_fields ->> 'id_proof_number' else t.id_proof_number end,
    photo_file_id = case when p_fields ? 'photo_file_id' then (p_fields ->> 'photo_file_id')::uuid else t.photo_file_id end,
    consents = case when p_fields ? 'consents' then t.consents || (p_fields -> 'consents') else t.consents end,
    custom_fields = case when p_fields ? 'custom_fields' then t.custom_fields || (p_fields -> 'custom_fields') else t.custom_fields end,
    tags = case when p_fields ? 'tags' then array(select jsonb_array_elements_text(p_fields -> 'tags')) else t.tags end,
    wa_mode = case when p_fields ? 'wa_mode' then coalesce(p_fields ->> 'wa_mode', 'auto') else t.wa_mode end,
    notes = case when p_fields ? 'notes' then p_fields ->> 'notes' else t.notes end,
    version = t.version + 1
  where t.id = p_id;
exception
  when check_violation or invalid_text_representation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

-- Patient as the reception screens show it.
create function private.patient_card(p public.patients)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p.id, 'uhid', p.uhid, 'title', p.title, 'full_name', p.full_name, 'gender', p.gender,
    'dob', p.dob, 'dob_estimated', p.dob_estimated, 'age', private.age_years(p.dob),
    'phone_e164', p.phone_e164, 'whatsapp_e164', p.whatsapp_e164, 'alt_phone_e164', p.alt_phone_e164,
    'email', p.email, 'city', p.city, 'area', p.area, 'family_group_id', p.family_group_id,
    'allergies', to_jsonb(p.allergies), 'tags', to_jsonb(p.tags), 'merged_into_id', p.merged_into_id);
$$;

------------------------------------------------------------------------------
-- Duplicate check: same phone (any of three numbers), or a very similar name with
-- the same birth date. Never decides anything: reception chooses.
------------------------------------------------------------------------------
create function public.find_patient_matches(p_phone_e164 text, p_full_name text, p_dob date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last10 text := nullif(right(coalesce(p_phone_e164, ''), 10), '');
  v_name text := lower(btrim(coalesce(p_full_name, '')));
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(m.card || jsonb_build_object('reasons', m.reasons) order by m.score desc, m.created_at desc)
    from (
      select private.patient_card(p) as card, p.created_at,
             array_remove(array[
               case when v_last10 is not null and v_last10 in (p.phone_last10, p.whatsapp_last10, p.alt_phone_last10) then 'phone' end,
               case when v_name <> '' and extensions.similarity(lower(p.full_name), v_name) >= 0.6 then 'name' end,
               case when p_dob is not null and p.dob = p_dob then 'dob' end
             ], null) as reasons,
             (case when v_last10 in (p.phone_last10, p.whatsapp_last10, p.alt_phone_last10) then 2 else 0 end)
             + extensions.similarity(lower(p.full_name), v_name) as score
      from public.patients p
      where p.merged_into_id is null
        and p.id in (
          select id from public.patients where v_last10 is not null and phone_last10 = v_last10
          union select id from public.patients where v_last10 is not null and whatsapp_last10 = v_last10
          union select id from public.patients where v_last10 is not null and alt_phone_last10 = v_last10
          union select id from public.patients
            where p_dob is not null and dob = p_dob and v_name <> '' and full_name operator(extensions.%) v_name
        )
      order by score desc
      limit 10
    ) m), '[]'::jsonb);
end;
$$;

------------------------------------------------------------------------------
-- Registration. p_decision is required whenever the patient might already exist:
--   new     → a new patient with a new UHID
--   update  → copy ONLY p_update_fields from the payload onto p_target_id
--   family  → a new patient in the same family as p_target_id
-- Idempotent on p_client_id (the new patient's id).
------------------------------------------------------------------------------
create function public.register_patient(
  p_payload jsonb,
  p_decision text,
  p_target_id uuid default null,
  p_update_fields text[] default null,
  p_request_id uuid default null,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_fields jsonb := private.patient_fields(p_payload);
  v_target public.patients;
  v_id uuid;
  v_uhid text;
  v_status text;
  v_family uuid;
begin
  if p_decision not in ('new', 'update', 'family') then
    perform private.fail('invalid_input', 'decision');
  end if;
  if p_decision in ('update', 'family') then
    select * into v_target from public.patients where id = p_target_id and merged_into_id is null for update;
    if not found then
      perform private.fail('not_found');
    end if;
  end if;

  if p_decision = 'update' then
    if p_update_fields is null or cardinality(p_update_fields) = 0 then
      perform private.fail('invalid_input', 'choose the fields to update');
    end if;
    -- Never overwrite anything the receptionist did not tick.
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_fields
    from jsonb_each(v_fields) e
    where e.key = any (p_update_fields) or (e.key = 'dob_estimated' and 'dob' = any (p_update_fields));
    perform private.patient_apply(v_target.id, v_fields);
    v_id := v_target.id;
    v_uhid := v_target.uhid;
    v_status := 'updated';
  else
    if p_client_id is not null then
      select id, uhid into v_id, v_uhid from public.patients where id = p_client_id;
      if found then
        return jsonb_build_object('patient_id', v_id, 'uhid', v_uhid, 'repeat', true);
      end if;
    end if;
    if not v_fields ? 'full_name' then
      perform private.fail('invalid_input', 'full_name');
    end if;
    if p_decision = 'family' then
      v_family := coalesce(v_target.family_group_id, v_target.id);
      update public.patients set family_group_id = v_family where id = v_target.id and family_group_id is null;
    end if;
    v_uhid := private.take_number('uhid');
    v_id := coalesce(p_client_id, gen_random_uuid());
    insert into public.patients (id, uhid, full_name, family_group_id, consents)
    values (v_id, v_uhid, v_fields ->> 'full_name', v_family,
            -- Consent ticked at the desk is recorded with who/when.
            coalesce((select jsonb_object_agg(c.key, c.value || jsonb_build_object('at', now(), 'by', v_staff))
                        from jsonb_each(coalesce(v_fields -> 'consents', '{}'::jsonb)) c), '{}'::jsonb));
    perform private.patient_apply(v_id, v_fields - 'consents' - 'full_name');
    update public.patients set version = 1 where id = v_id;
    v_status := case when p_decision = 'family' then 'family' else 'created' end;
  end if;

  if p_request_id is not null then
    update public.registration_requests
       set status = v_status, patient_id = v_id, reviewed_by = v_staff, reviewed_at = now()
     where id = p_request_id and status = 'pending';
    if not found then
      perform private.fail('not_found', 'registration request already handled');
    end if;
  end if;
  return jsonb_build_object('patient_id', v_id, 'uhid', v_uhid, 'repeat', false);
end;
$$;

-- Edit from the patient file. p_version = optimistic lock ("someone else changed this").
create function public.update_patient(p_id uuid, p_patch jsonb, p_version integer, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.patients;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_row from public.patients where id = p_id for update;
  if not found or v_row.merged_into_id is not null then
    perform private.fail('not_found');
  end if;
  if v_row.version <> p_version then
    perform private.fail('stale_version');
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  perform private.patient_apply(p_id, private.patient_fields(p_patch - 'consents') ||
    case when p_patch ? 'consents' then jsonb_build_object('consents', (
      select coalesce(jsonb_object_agg(c.key, c.value || jsonb_build_object('at', now(), 'by', auth.uid())), '{}'::jsonb)
      from jsonb_each(p_patch -> 'consents') c)) else '{}'::jsonb end);
  select * into v_row from public.patients where id = p_id;
  return private.patient_card(v_row) || jsonb_build_object('version', v_row.version);
end;
$$;

-- Link two existing patients as one family.
create function public.link_family(p_patient_id uuid, p_relative_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.patients;
  v_b public.patients;
  v_group uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_a from public.patients where id = p_patient_id and merged_into_id is null for update;
  select * into v_b from public.patients where id = p_relative_id and merged_into_id is null for update;
  if v_a.id is null or v_b.id is null or v_a.id = v_b.id then
    perform private.fail('not_found');
  end if;
  v_group := coalesce(v_a.family_group_id, v_b.family_group_id, v_a.id);
  -- Joining two existing families: everyone moves into one group.
  update public.patients set family_group_id = v_group
   where id in (v_a.id, v_b.id)
      or (family_group_id is not null and family_group_id in (v_a.family_group_id, v_b.family_group_id));
  return v_group;
end;
$$;

create function public.unlink_family(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  update public.patients set family_group_id = null where id = p_patient_id;
end;
$$;

------------------------------------------------------------------------------
-- QR self-registration
------------------------------------------------------------------------------
-- Reception asks for a link. The token is returned ONCE (it goes into the QR); only its hash is kept.
create function public.create_public_link(p_kind text, p_patient_id uuid default null, p_minutes integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_expires timestamptz := now() + make_interval(mins => least(greatest(coalesce(p_minutes, 30), 5), 60 * 24 * 365));
begin
  if p_kind not in ('self_registration', 'phone_scan') then
    perform private.fail('invalid_input', 'kind');
  end if;
  insert into public.public_links (kind, token_hash, patient_id, created_by, expires_at, max_uses)
  values (p_kind, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_patient_id, v_staff, v_expires,
          case when p_kind = 'phone_scan' then 1 end);
  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

-- Called by the public-form Edge Function (service role only) with the token from the QR.
create function public.public_form_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
begin
  select * into v_link from public.public_links
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and kind = 'self_registration';
  if not found or v_link.expires_at < now() or (v_link.max_uses is not null and v_link.uses >= v_link.max_uses) then
    return jsonb_build_object('valid', false);
  end if;
  return jsonb_build_object(
    'valid', true,
    'clinic', (select jsonb_build_object('name', c.name, 'logo_path', c.logo_path) from public.clinic_settings c where c.branch_code = 'main'),
    'form', coalesce((select s.value from public.app_settings s where s.section = 'registration_form'), '{}'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'label', l.label) order by l.sort, l.label)
                             from public.lookup_values l where l.kind = 'relation' and l.active), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'label', l.label) order by l.sort, l.label)
                           from public.lookup_values l where l.kind = 'lead_source' and l.active), '[]'::jsonb));
end;
$$;

create function public.public_form_submit(p_token text, p_payload jsonb, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
  v_fields jsonb;
  v_id uuid;
begin
  select * into v_link from public.public_links
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and kind = 'self_registration'
   for update;
  if not found or v_link.expires_at < now() or (v_link.max_uses is not null and v_link.uses >= v_link.max_uses) then
    perform private.fail('link_expired');
  end if;
  -- At most 5 forms per device/network in 10 minutes.
  if p_ip_hash is not null and (select count(*) from public.registration_requests
       where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes') >= 5 then
    perform private.fail('rate_limited');
  end if;
  v_fields := private.patient_fields(p_payload); -- validates, same rules as the desk
  if not v_fields ? 'full_name' then
    perform private.fail('invalid_input', 'full_name');
  end if;

  insert into public.registration_requests (link_id, payload, full_name, phone_last10, ip_hash)
  values (v_link.id, p_payload, v_fields ->> 'full_name', right(v_fields ->> 'phone_e164', 10), p_ip_hash)
  returning id into v_id;
  update public.public_links set uses = uses + 1 where id = v_link.id;

  -- Bell for every active receptionist and admin.
  insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
  select s.id, 'registration_pending', 'New self-registration', v_fields ->> 'full_name',
         '/patients/pending', format('registration:%s:%s', v_id, s.id)
  from public.staff s where s.active and s.role in ('receptionist', 'admin');
  return jsonb_build_object('ok', true);
end;
$$;
-- Server-only: the public-form Edge Function calls these with the service role after
-- checking the bot test. Signed-in staff and visitors may not call them directly.
revoke execute on function public.public_form_info(text), public.public_form_submit(text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.public_form_info(text), public.public_form_submit(text, jsonb, text) to service_role;

create function public.pending_registrations(p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'full_name', r.full_name, 'payload', r.payload,
           'created_at', r.created_at) order by r.created_at desc, r.id desc), '[]'::jsonb)
    into v_rows
  from (
    select * from public.registration_requests q
    where q.status = 'pending'
      and (v_c is null or (q.created_at, q.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by q.created_at desc, q.id desc
    limit v_limit + 1
  ) r;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality x where x.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'created_at', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

create function public.discard_registration(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('invalid_input', 'reason');
  end if;
  update public.registration_requests
     set status = 'discarded', discard_reason = btrim(p_reason), reviewed_by = v_staff, reviewed_at = now()
   where id = p_request_id and status = 'pending';
  if not found then
    perform private.fail('not_found');
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Search and lists
------------------------------------------------------------------------------
-- One search box: digits → phone or UHID; text → name (fuzzy) or UHID. Max 10 results.
-- Later phases add leads to the results.
create function public.global_search(p_q text, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 20);
  v_result jsonb;
begin
  perform private.require_staff();
  v_role := private.my_role();
  if length(v_q) < 2 or v_role not in ('receptionist', 'admin') then
    return '[]'::jsonb;
  end if;

  with hits as (
    -- UHID: exact or starts with
    select p.id, 0 as rank, 1.0::real as sim from public.patients p
     where lower(p.uhid) like lower(private.like_escape(v_q)) || '%' and p.merged_into_id is null
    union all
    -- phone: last 10 digits, or the end of the number when fewer digits are typed
    select p.id, 1, 1.0 from public.patients p
     where length(v_digits) >= 10 and p.merged_into_id is null
       and right(v_digits, 10) in (p.phone_last10, p.whatsapp_last10, p.alt_phone_last10)
    union all
    select p.id, 2, 1.0 from public.patients p
     where length(v_digits) between 4 and 9 and length(v_digits) = length(regexp_replace(v_q, '[\s+-]', '', 'g'))
       and p.merged_into_id is null and p.phone_last10 like '%' || v_digits
    union all
    -- name: contains, best match first
    select p.id, 3, extensions.similarity(p.full_name, v_q) from public.patients p
     where length(v_digits) = 0 and p.merged_into_id is null
       and p.full_name ilike '%' || private.like_escape(v_q) || '%'
  ), best as (
    select h.id, min(h.rank) as rank, max(h.sim) as sim from hits h group by h.id
    order by min(h.rank), max(h.sim) desc limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', 'patient', 'id', p.id, 'title', p.full_name, 'uhid', p.uhid,
           'subtitle', concat_ws(' · ', p.uhid, p.phone_e164,
             case when p.dob is not null then private.age_years(p.dob)::text || ' y' end))
         order by b.rank, b.sim desc, p.full_name), '[]'::jsonb)
    into v_result
  from best b join public.patients p on p.id = b.id;
  return v_result;
end;
$$;

-- Recent patients (keyset, newest first) for the Patients page.
create function public.patients_recent(p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select coalesce(jsonb_agg(private.patient_card(p) || jsonb_build_object('created_at', p.created_at)
           order by p.created_at desc, p.id desc), '[]'::jsonb)
    into v_rows
  from (
    select * from public.patients x
    where x.merged_into_id is null
      and (v_c is null or (x.created_at, x.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by x.created_at desc, x.id desc
    limit v_limit + 1
  ) p;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality x where x.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'created_at', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

------------------------------------------------------------------------------
-- Patient file
------------------------------------------------------------------------------
-- The header strip + everything the Overview tab shows. Later phases add balance,
-- active treatments and upcoming appointments here.
create function public.patient_header(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.patients;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v from public.patients where id = p_patient_id;
  if not found then
    perform private.fail('not_found');
  end if;
  return to_jsonb(v) - 'phone_last10' - 'whatsapp_last10' - 'alt_phone_last10'
    || jsonb_build_object(
      'age', private.age_years(v.dob),
      'merged_into_uhid', (select uhid from public.patients where id = v.merged_into_id),
      'heard_from', (select label from public.lookup_values where id = v.heard_from_id),
      'attender_relation', (select label from public.lookup_values where id = v.attender_relation_id),
      'family', coalesce((
        select jsonb_agg(private.patient_card(f) order by f.created_at)
        from public.patients f
        where v.family_group_id is not null and f.family_group_id = v.family_group_id
          and f.id <> v.id and f.merged_into_id is null), '[]'::jsonb),
      'documents_count', (select count(*) from public.documents d where d.patient_id = v.id and not d.archived));
end;
$$;

-- Timeline: everything that happened to the patient, newest first (keyset on at, id).
-- Each phase adds its events to private.patient_events.
create function private.patient_events(p_patient_id uuid)
returns table (at timestamptz, id uuid, kind text, title text, ref jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select p.created_at, p.id, 'registered', 'Registered — UHID ' || p.uhid, jsonb_build_object('uhid', p.uhid)
  from public.patients p where p.id = p_patient_id
  union all
  select d.created_at, d.id, 'document', d.title,
         jsonb_build_object('document_id', d.id, 'file_id', d.file_id, 'kind', l.label)
  from public.documents d left join public.lookup_values l on l.id = d.kind_id
  where d.patient_id = p_patient_id and not d.archived
  union all
  select m.merged_at, m.id, 'merged', 'Merged another record into this one',
         jsonb_build_object('from_id', m.from_id, 'moved', m.moved)
  from public.patient_merges m where m.into_id = p_patient_id;
$$;

create function public.patient_timeline(p_patient_id uuid, p_kinds text[] default null, p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'id', e.id, 'kind', e.kind, 'title', e.title, 'ref', e.ref)
           order by e.at desc, e.id desc), '[]'::jsonb)
    into v_rows
  from (
    select * from private.patient_events(p_patient_id) x
    where (p_kinds is null or x.kind = any (p_kinds))
      and (v_c is null or (x.at, x.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by x.at desc, x.id desc
    limit v_limit + 1
  ) e;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality x where x.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'at', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

------------------------------------------------------------------------------
-- Documents
------------------------------------------------------------------------------
create function public.create_document(p_doc jsonb, p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_file public.files;
  v_patient uuid := (p_doc ->> 'patient_id')::uuid;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  if exists (select 1 from public.documents where id = p_client_id) then
    return p_client_id;
  end if;
  select * into v_file from public.files where id = (p_doc ->> 'file_id')::uuid;
  if not found or v_file.status <> 'uploaded' then
    perform private.fail('upload_incomplete');
  end if;
  if v_file.owner_staff_id <> v_staff and not private.has_role('admin') then
    perform private.fail('not_allowed');
  end if;
  if not exists (select 1 from public.patients where id = v_patient and merged_into_id is null) then
    perform private.fail('not_found');
  end if;
  update public.files set patient_id = v_patient, linked_table = 'documents', linked_id = p_client_id
   where id in (v_file.id, (p_doc ->> 'thumbnail_file_id')::uuid);
  insert into public.documents (id, patient_id, kind_id, title, doc_date, doctor_id, file_id, thumbnail_file_id, page_count)
  values (p_client_id, v_patient, (p_doc ->> 'kind_id')::uuid,
          coalesce(nullif(btrim(p_doc ->> 'title'), ''), 'Document'),
          coalesce((p_doc ->> 'doc_date')::date, (private.ist(now()))::date),
          (p_doc ->> 'doctor_id')::uuid, v_file.id, (p_doc ->> 'thumbnail_file_id')::uuid,
          (p_doc ->> 'page_count')::int);
  perform private.library_used('lookup_values', (p_doc ->> 'kind_id')::uuid);
  return p_client_id;
end;
$$;

create function public.archive_document(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update public.documents set archived = true where id = p_id;
  if not found then
    perform private.fail('not_found');
  end if;
end;
$$;

-- "This file was already uploaded for this patient" (same SHA-256).
create function public.find_duplicate_file(p_sha256 text, p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return (
    select jsonb_build_object('document_id', d.id, 'title', d.title, 'doc_date', d.doc_date)
    from public.files f join public.documents d on d.file_id = f.id
    where f.sha256 = lower(p_sha256) and d.patient_id = p_patient_id and not d.archived
    limit 1);
end;
$$;

------------------------------------------------------------------------------
-- Admin merge: every row that points at the duplicate moves to the kept patient.
-- Foreign keys are found from the catalog, so tables added by later phases are
-- included automatically ('merge:keep' foreign keys excepted).
------------------------------------------------------------------------------
create function public.merge_patients(p_from uuid, p_into uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_from public.patients;
  v_into public.patients;
  r record;
  v_n integer;
  v_moved jsonb := '{}'::jsonb;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('invalid_input', 'reason');
  end if;
  if p_from = p_into then
    perform private.fail('invalid_input', 'same patient');
  end if;
  select * into v_from from public.patients where id = p_from for update;
  select * into v_into from public.patients where id = p_into for update;
  if v_from.id is null or v_into.id is null or v_from.merged_into_id is not null or v_into.merged_into_id is not null then
    perform private.fail('not_found');
  end if;
  perform set_config('app.reason', btrim(p_reason), true);

  for r in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.patients'::regclass and cardinality(c.conkey) = 1
      and coalesce(obj_description(c.oid, 'pg_constraint'), '') <> 'merge:keep'
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_into, p_from;
    exception when unique_violation then
      perform private.fail('merge_conflict', r.tbl);
    end;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object(r.tbl || '.' || r.col, v_n);
    end if;
  end loop;

  -- Keep what the kept record lacks (never overwrite).
  update public.patients t set
    phone_e164 = coalesce(t.phone_e164, v_from.phone_e164),
    whatsapp_e164 = coalesce(t.whatsapp_e164, v_from.whatsapp_e164),
    alt_phone_e164 = coalesce(t.alt_phone_e164, v_from.alt_phone_e164, case when v_from.phone_e164 is distinct from t.phone_e164 then v_from.phone_e164 end),
    email = coalesce(t.email, v_from.email),
    dob = coalesce(t.dob, v_from.dob),
    allergies = array(select distinct unnest(t.allergies || v_from.allergies)),
    conditions = array(select distinct unnest(t.conditions || v_from.conditions)),
    family_group_id = coalesce(t.family_group_id, v_from.family_group_id),
    version = t.version + 1
  where t.id = p_into;
  update public.patients set merged_into_id = p_into, family_group_id = null, version = version + 1 where id = p_from;
  insert into public.patient_merges (from_id, into_id, moved, merged_by, reason)
  values (p_from, p_into, v_moved, v_admin, btrim(p_reason));
  return jsonb_build_object('into', p_into, 'moved', v_moved);
end;
$$;

------------------------------------------------------------------------------
-- DocPulse import (admin). Up to 500 rows per call. dry_run checks without saving.
-- Rows: {full_name, phone, gender, dob | age_years, uhid?, email?, address?, city?, pincode?}
-- A row with an existing UHID updates nothing and is reported, never overwritten.
------------------------------------------------------------------------------
create function public.import_patients(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_i integer := 0;
  v_ok integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_fields jsonb;
  v_uhid text;
  v_id uuid;
  v_detail text;
  v_message text;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    perform private.fail('invalid_input', 'at most 500 rows per batch');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      v_fields := private.patient_fields(v_row);
      if not v_fields ? 'full_name' then
        raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'full_name';
      end if;
      v_uhid := nullif(btrim(v_row ->> 'uhid'), '');
      if v_uhid is not null and exists (select 1 from public.patients where lower(uhid) = lower(v_uhid)) then
        raise exception using errcode = 'P0001', message = 'duplicate', detail = 'uhid';
      end if;
      if not p_dry_run then
        v_id := gen_random_uuid();
        insert into public.patients (id, uhid, full_name)
        values (v_id, coalesce(v_uhid, private.take_number('uhid')), v_fields ->> 'full_name');
        perform private.patient_apply(v_id, v_fields - 'full_name');
      end if;
      v_ok := v_ok + 1;
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail, v_message = message_text;
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', nullif(v_detail, ''), 'message', v_message);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errors', v_errors, 'dry_run', p_dry_run);
end;
$$;

grant execute on function
  public.find_patient_matches(text, text, date),
  public.register_patient(jsonb, text, uuid, text[], uuid, uuid),
  public.update_patient(uuid, jsonb, integer, text),
  public.link_family(uuid, uuid),
  public.unlink_family(uuid),
  public.create_public_link(text, uuid, integer),
  public.pending_registrations(text, integer),
  public.discard_registration(uuid, text),
  public.global_search(text, integer),
  public.patients_recent(text, integer),
  public.patient_header(uuid),
  public.patient_timeline(uuid, text[], text, integer),
  public.create_document(jsonb, uuid),
  public.archive_document(uuid, text),
  public.find_duplicate_file(text, uuid),
  public.merge_patients(uuid, uuid, text),
  public.import_patients(jsonb, boolean)
to authenticated;

select private.lock_down_public_functions();
