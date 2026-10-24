-- Pearl CRM — Phase 9: leads, sales, Meta Lead Ads (PLAN.md C3 "Leads and sales", C7, D2 "Leads and sales").
-- Leads with an owner (sales executive), round-robin assignment from a pool, stage automation
-- (booking → consultation_booked, arrival → consulted, treatment → converted), call logs made
-- on the phone, the Meta Lead Ads webhook's database side, CSV import, phone sync for Android
-- (sync_pull) and the sales dashboards. Every list is paged; every dashboard query is one
-- grouped pass over a date range of at most one year (CLAUDE.md scale rules).

create type public.lead_stage as enum (
  'new', 'contacted', 'interested', 'consultation_booked', 'consulted', 'surgery_scheduled', 'converted',
  'lost', 'not_reachable', 'junk'
);
create type public.call_direction as enum ('outgoing', 'incoming', 'missed');
create type public.call_outcome as enum ('connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'call_back');

-- The ladder a lead climbs. lost / junk sit outside it (-1); not_reachable counts as new.
create function private.stage_rank(p_stage public.lead_stage)
returns smallint
language sql
immutable
parallel safe
as $$
  select (case p_stage
    when 'new' then 0 when 'not_reachable' then 0 when 'contacted' then 1 when 'interested' then 2
    when 'consultation_booked' then 3 when 'consulted' then 4 when 'surgery_scheduled' then 5
    when 'converted' then 6 else -1 end)::smallint;
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  sl_no bigint generated always as identity unique,
  lead_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  name text not null check (length(btrim(name)) between 1 and 200),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_last10 text generated always as (right(phone_e164, 10)) stored,
  alt_phone_e164 text check (alt_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  alt_phone_last10 text generated always as (right(alt_phone_e164, 10)) stored,
  email text check (length(email) <= 200),
  treatment_template_id uuid references public.treatment_templates (id),
  treatment_text text check (length(treatment_text) <= 200),
  assigned_to uuid references public.staff (id),
  assigned_at timestamptz,
  doctor_id uuid references public.doctors (id),
  source_id uuid references public.lookup_values (id),
  source_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(source_detail) = 'object'),
  meta_leadgen_id text unique,
  referred_by_text text check (length(referred_by_text) <= 200),
  referred_by_staff_id uuid references public.staff (id),
  appointment_mode public.appt_mode,
  surgery_date date,
  next_followup_at timestamptz,
  amount_quoted_paise bigint check (amount_quoted_paise >= 0),
  amount_finalised_paise bigint check (amount_finalised_paise >= 0),
  amount_finalised_by uuid references public.staff (id),
  amount_finalised_at timestamptz,
  comments1 text check (length(comments1) <= 2000),
  comments2 text check (length(comments2) <= 2000),
  reminder_on boolean not null default true,   -- automatic WhatsApp reminders for this lead (Phase 10)
  wa_mode text not null default 'auto' check (wa_mode in ('auto', 'manual')),
  stage public.lead_stage not null default 'new',
  stage_changed_at timestamptz not null default now(),
  max_stage_rank smallint not null default 0,  -- highest rung ever reached (the funnel keeps lost leads)
  lost_reason_id uuid references public.lookup_values (id),
  lost_recording_id uuid,                      -- FK added in Phase 12 (recordings)
  converted_at timestamptz,
  patient_id uuid references public.patients (id),
  duplicate_of_id uuid references public.leads (id),
  created_via text not null default 'web' check (created_via in ('web', 'android', 'meta', 'import', 'reception', 'bdm')),
  first_call_at timestamptz,
  last_activity_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text check (length(deleted_reason) <= 300),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (stage <> 'lost' or lost_reason_id is not null)
);
create index leads_owner on public.leads (assigned_to, stage, next_followup_at) where deleted_at is null;
create index leads_phone on public.leads (phone_last10) where deleted_at is null;
create index leads_alt_phone on public.leads (alt_phone_last10) where deleted_at is null and alt_phone_last10 is not null;
create index leads_name_trgm on public.leads using gin (name extensions.gin_trgm_ops) where deleted_at is null;
create index leads_date on public.leads (lead_date desc, id) where deleted_at is null;
create index leads_stage_date on public.leads (stage, lead_date) where deleted_at is null;
create index leads_due on public.leads (next_followup_at) where deleted_at is null and next_followup_at is not null;
create index leads_unassigned on public.leads (lead_date) where deleted_at is null and assigned_to is null;
create index leads_patient on public.leads (patient_id) where patient_id is not null;
create index leads_converted on public.leads (converted_at) where converted_at is not null;
create index leads_finalised on public.leads (amount_finalised_at) where amount_finalised_at is not null;
create index leads_sync on public.leads (updated_at, id);
create index leads_owner_sync on public.leads (assigned_to, updated_at, id);
create index leads_creator_sync on public.leads (created_by, updated_at, id);
create index leads_duplicate on public.leads (duplicate_of_id) where duplicate_of_id is not null;
create trigger leads_touch before update on public.leads
  for each row execute function private.touch_updated();
create trigger leads_audit after insert or update or delete on public.leads
  for each row execute function private.audit_row();

-- Stage bookkeeping in one place, whichever function changed the stage.
create function private.leads_stage_track()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.max_stage_rank := greatest(private.stage_rank(new.stage), 0);
    if new.stage = 'converted' then
      new.converted_at := coalesce(new.converted_at, now());
    end if;
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    new.max_stage_rank := greatest(old.max_stage_rank, private.stage_rank(new.stage));
    if new.stage = 'converted' then
      new.converted_at := coalesce(old.converted_at, now());
    end if;
    if new.stage <> 'lost' then
      new.lost_reason_id := null;
    end if;
  end if;
  return new;
end;
$$;
create trigger leads_stage before insert or update on public.leads
  for each row execute function private.leads_stage_track();

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  staff_id uuid references public.staff (id),
  kind text not null check (kind in ('created', 'note', 'stage', 'call', 'assigned', 'amount', 'edit', 'linked',
                                     'duplicate', 'appointment', 'enquired_again', 'deleted')),
  body text check (length(body) <= 4000),
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index lead_activities_lead on public.lead_activities (lead_id, at desc, id);

create table public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_staff uuid references public.staff (id),
  to_staff uuid references public.staff (id),
  by_staff uuid references public.staff (id),
  method text not null check (method in ('manual', 'round_robin', 'self')),
  reason text check (length(reason) <= 300),
  at timestamptz not null default now()
);
create index lead_assignments_lead on public.lead_assignments (lead_id, at desc);
-- Tells a phone to drop a lead that was reassigned away (sync_pull "removed").
create index lead_assignments_from on public.lead_assignments (from_staff, at) where from_staff is not null;

-- Round-robin pool: who gets new leads, optionally only from some sources.
create table public.lead_pool (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  active boolean not null default true,
  source_ids uuid[] not null default '{}',
  sort integer not null default 100,
  last_assigned_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger lead_pool_touch before update on public.lead_pool
  for each row execute function private.touch_updated();

-- Calls: the ID is made on the phone, so a retried upload never adds a second row.
create table public.call_logs (
  id uuid primary key,
  staff_id uuid not null references public.staff (id),
  lead_id uuid references public.leads (id),
  patient_id uuid references public.patients (id),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_last10 text generated always as (right(phone_e164, 10)) stored,
  direction public.call_direction not null,
  started_at timestamptz not null,
  duration_s integer not null default 0 check (duration_s between 0 and 86400),
  outcome public.call_outcome,
  notes text check (length(notes) <= 2000),
  source text not null default 'app' check (source in ('app', 'call_log')),
  device_call_key text check (length(device_call_key) <= 200),
  recording_id uuid,                           -- FK added in Phase 12 (recordings)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (staff_id, device_call_key)
);
create index call_logs_lead on public.call_logs (lead_id, started_at desc) where lead_id is not null;
create index call_logs_staff on public.call_logs (staff_id, started_at desc);
create index call_logs_patient on public.call_logs (patient_id, started_at desc) where patient_id is not null;
create index call_logs_started on public.call_logs (started_at);
create index call_logs_sync on public.call_logs (staff_id, updated_at, id);
create index call_logs_sync_all on public.call_logs (updated_at, id);
create trigger call_logs_touch before update on public.call_logs
  for each row execute function private.touch_updated();

-- Meta Lead Ads: one row per leadgen id (the webhook's idempotency key).
create table public.meta_lead_events (
  id uuid primary key default gen_random_uuid(),
  leadgen_id text not null unique check (leadgen_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  page_id text check (length(page_id) <= 64),
  form_id text check (length(form_id) <= 64),
  ad_id text check (length(ad_id) <= 64),
  meta_created_at timestamptz,
  status text not null default 'received' check (status in ('received', 'created', 'duplicate', 'failed')),
  lead_id uuid references public.leads (id),
  attempts integer not null default 0,
  error text check (length(error) <= 1000),
  payload jsonb,                               -- the form answers; cleared after 14 days
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index meta_lead_events_recent on public.meta_lead_events (received_at desc, id);
create index meta_lead_events_failed on public.meta_lead_events (received_at desc) where status in ('failed', 'received');

-- The lead_id columns earlier phases left waiting.
alter table public.appointments add constraint appointments_lead_fk foreign key (lead_id) references public.leads (id);
alter table public.followups add constraint followups_lead_fk foreign key (lead_id) references public.leads (id);
alter table public.files add constraint files_lead_fk foreign key (lead_id) references public.leads (id);
alter table public.patient_treatments add constraint patient_treatments_lead_fk foreign key (lead_id) references public.leads (id);
alter table public.patients add constraint patients_lead_fk foreign key (lead_id) references public.leads (id);
create index patient_treatments_lead on public.patient_treatments (lead_id) where lead_id is not null;
create index followups_lead on public.followups (lead_id) where lead_id is not null;
create index followups_sync on public.followups (assigned_to, updated_at, id);
create index followups_sales_sync on public.followups (updated_at, id) where source = 'sales';
create index appointments_booked_by on public.appointments (booked_by, updated_at, id);
create index appointments_lead_sync on public.appointments (updated_at, id) where lead_id is not null;
create index appointments_lead_created on public.appointments (created_at) where lead_id is not null;
create index appointments_lead_slot on public.appointments (slot_start) where lead_id is not null;
create index lookup_values_sync on public.lookup_values (updated_at, id);

------------------------------------------------------------------------------
-- RLS (PLAN.md C7). Writes go through the RPCs below.
------------------------------------------------------------------------------
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.lead_assignments enable row level security;
alter table public.lead_pool enable row level security;
alter table public.call_logs enable row level security;
alter table public.meta_lead_events enable row level security;
grant select on public.leads, public.lead_activities, public.lead_assignments, public.lead_pool,
  public.call_logs, public.meta_lead_events to authenticated;

create policy leads_select on public.leads for select to authenticated
  using ((select private.has_role('sales_manager', 'admin')) or assigned_to = (select private.my_staff_id()));
-- Activities and assignment history: managers and admins directly; executives through lead_activities().
create policy lead_activities_select on public.lead_activities for select to authenticated
  using ((select private.has_role('sales_manager', 'admin')));
create policy lead_assignments_select on public.lead_assignments for select to authenticated
  using ((select private.has_role('sales_manager', 'admin')));
create policy lead_pool_select on public.lead_pool for select to authenticated
  using ((select private.has_role('sales_manager', 'admin')));
create policy call_logs_select on public.call_logs for select to authenticated
  using (
    (select private.has_role('sales_manager', 'admin'))
    or staff_id = (select private.my_staff_id())
    or ((select private.has_role('receptionist')) and patient_id is not null)
  );
create policy meta_lead_events_select on public.meta_lead_events for select to authenticated
  using ((select private.has_role('admin')));

-- Appointments: sales see their leads' bookings (executives: assigned leads + their own bookings).
drop policy appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
  using (
    (select private.has_role('receptionist', 'admin'))
    or ((select private.has_role('sales_manager')) and lead_id is not null)
    or booked_by = (select private.my_staff_id())
    or lead_id in (select l.id from public.leads l where l.assigned_to = (select private.my_staff_id()))
  );
-- Follow-ups: managers also see every sales follow-up.
drop policy followups_select on public.followups;
create policy followups_select on public.followups for select to authenticated
  using (
    (select private.has_role('admin'))
    or assigned_to = (select private.my_staff_id())
    or ((select private.has_role('receptionist')) and (assigned_to is null or patient_id is not null))
    or ((select private.has_role('sales_manager')) and source = 'sales')
  );

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
-- The lead for a read or write by the caller: managers and admins any; executives only
-- their assigned leads; reception (p_reception) for linking. Locks the row when p_lock.
create function private.lead_for(p_id uuid, p_lock boolean default false, p_reception boolean default false)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.leads;
  v_me uuid := private.my_staff_id();
begin
  if p_lock then
    select * into v_row from public.leads where id = p_id and deleted_at is null for update;
  else
    select * into v_row from public.leads where id = p_id and deleted_at is null;
  end if;
  if not found then
    perform private.fail('not_found', 'lead');
  end if;
  if not (private.has_role('sales_manager', 'admin')
          or v_row.assigned_to = v_me
          or (p_reception and private.has_role('receptionist'))) then
    perform private.fail('not_allowed');
  end if;
  return v_row;
end;
$$;

create function private.lead_log(p_lead uuid, p_kind text, p_body text default null, p_data jsonb default '{}'::jsonb,
                                  p_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lead_activities (id, lead_id, staff_id, kind, body, data)
  values (coalesce(p_id, gen_random_uuid()), p_lead, private.my_staff_id(), p_kind, nullif(btrim(p_body), ''),
          coalesce(p_data, '{}'::jsonb))
  on conflict (id) do nothing;
$$;

-- Next owner from the round-robin pool: the active executive who waited longest, among those
-- taking this source. Inactive or deactivated staff are skipped. clock_timestamp() so a batch
-- import in one transaction still goes round.
create function private.next_assignee(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if not coalesce((private.setting('sales', 'round_robin', 'true'))::boolean, true) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lead_round_robin', 42));
  select p.staff_id into v_staff
  from public.lead_pool p
  join public.staff s on s.id = p.staff_id
  where p.active and s.active and s.role = 'sales_executive'
    and (cardinality(p.source_ids) = 0 or p_source_id = any (p.source_ids))
  order by p.last_assigned_at nulls first, p.sort, s.full_name, s.id
  limit 1;
  if v_staff is not null then
    update public.lead_pool set last_assigned_at = clock_timestamp() where staff_id = v_staff;
  end if;
  return v_staff;
end;
$$;

-- One open sales follow-up per lead, mirrored in leads.next_followup_at ("Due date").
create function private.set_lead_followup(p_lead_id uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
  v_open public.followups;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  select * into v_open from public.followups
   where kind = 'followup' and ref_table = 'leads' and ref_id = p_lead_id and status = 'open';
  if v_open.id is not null and p_at is not null and v_open.due_at = p_at
     and v_open.assigned_to is not distinct from v_lead.assigned_to then
    return;
  end if;
  if v_open.id is not null then
    update public.followups set status = 'cancelled', done_at = now(), done_by = private.my_staff_id(), outcome = 'replaced'
     where id = v_open.id;
  end if;
  update public.leads set next_followup_at = p_at where id = p_lead_id and next_followup_at is distinct from p_at;
  if p_at is not null and v_lead.assigned_to is not null then
    insert into public.followups (kind, lead_id, patient_id, due_date, due_at, reason, source, assigned_to, ref_table, ref_id)
    values ('followup', p_lead_id, v_lead.patient_id, (private.ist(p_at))::date, p_at,
            left('Call ' || v_lead.name, 500), 'sales', v_lead.assigned_to, 'leads', p_lead_id);
  end if;
end;
$$;

-- Moves a lead forward automatically (never backwards, never out of junk; a lost lead that
-- books or starts treatment comes back).
create function private.lead_auto_stage(p_lead_id uuid, p_stage public.lead_stage, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.lead_stage;
begin
  select stage into v_from from public.leads where id = p_lead_id and deleted_at is null for update;
  if v_from is null or v_from = 'junk' or (v_from <> 'lost' and private.stage_rank(v_from) >= private.stage_rank(p_stage)) then
    return;
  end if;
  update public.leads set stage = p_stage, last_activity_at = now(), version = version + 1 where id = p_lead_id;
  insert into public.lead_activities (lead_id, staff_id, kind, data)
  values (p_lead_id, private.my_staff_id(), 'stage',
          jsonb_build_object('from', v_from, 'to', p_stage, 'auto', true) || coalesce(p_data, '{}'::jsonb));
  if p_stage = 'converted' then
    perform private.set_lead_followup(p_lead_id, null);
  end if;
end;
$$;

create function private.notify_staff(p_staff uuid, p_type text, p_title text, p_body text, p_link text, p_dedupe text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
  select p_staff, p_type, p_title, p_body, p_link, p_dedupe
  where p_staff is not null and p_staff is distinct from private.my_staff_id()
  on conflict (dedupe_key) do nothing;
$$;

-- A lead as the apps show it: the row plus labels (one lead).
create function private.lead_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(l) || jsonb_build_object(
    'assigned_name', s.full_name,
    'source_label', src.label,
    'source_code', src.code,
    'treatment', coalesce(tt.name, l.treatment_text),
    'doctor_name', coalesce(d.display_name, d.full_name),
    'lost_reason', lr.label,
    'uhid', p.uhid,
    'patient_name', p.full_name,
    'amount_locked', exists (select 1 from public.patient_treatments t where t.lead_id = l.id and t.status <> 'cancelled'))
  from public.leads l
  left join public.staff s on s.id = l.assigned_to
  left join public.lookup_values src on src.id = l.source_id
  left join public.treatment_templates tt on tt.id = l.treatment_template_id
  left join public.doctors d on d.id = l.doctor_id
  left join public.lookup_values lr on lr.id = l.lost_reason_id
  left join public.patients p on p.id = l.patient_id
  where l.id = p_id;
$$;

-- Other live leads with the same number (phone or alternate, either way round).
create function private.lead_duplicates(p_phone_e164 text, p_alt_e164 text, p_exclude uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'sl_no', l.sl_no, 'name', l.name, 'stage', l.stage, 'lead_date', l.lead_date,
           'assigned_name', s.full_name, 'phone_e164', l.phone_e164) order by l.created_at desc), '[]'::jsonb)
  from (
    select distinct on (l.id) l.* from public.leads l
    where l.deleted_at is null and (p_exclude is null or l.id <> p_exclude)
      and (l.phone_last10 in (right(p_phone_e164, 10), right(p_alt_e164, 10))
           or l.alt_phone_last10 in (right(p_phone_e164, 10), right(p_alt_e164, 10)))
    limit 10
  ) l
  left join public.staff s on s.id = l.assigned_to;
$$;

------------------------------------------------------------------------------
-- Create (one path for the desk, the phones, Meta and the import)
------------------------------------------------------------------------------
-- p: {name, phone (E.164), alt_phone, email, lead_date, treatment_template_id, treatment_text,
--     source_id | source_code, source_detail, referred_by_text, referred_by_staff_id, doctor_id,
--     appointment_mode, surgery_date, next_followup_at, amount_quoted_paise, comments1, comments2,
--     assigned_to (managers/admin only), stage, lost_reason_id, amount_finalised_paise, meta_leadgen_id,
--     duplicate_of_id}
create function private.lead_insert(p jsonb, p_id uuid, p_via text)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.my_staff_id();
  v_role public.staff_role := private.my_role();
  v_source uuid := (p ->> 'source_id')::uuid;
  v_assignee uuid;
  v_method text;
  v_patient uuid;
  v_row public.leads;
begin
  if v_source is null and nullif(p ->> 'source_code', '') is not null then
    select id into v_source from public.lookup_values
     where kind = 'lead_source' and code = p ->> 'source_code' and merged_into_id is null;
  end if;
  if v_source is null and v_role = 'bdm' then
    select id into v_source from public.lookup_values where kind = 'lead_source' and code = 'bdm';
  end if;
  if v_source is not null and not exists (select 1 from public.lookup_values where id = v_source and kind = 'lead_source') then
    perform private.fail('invalid_input', 'source');
  end if;

  -- Owner: managers/admins may choose; an executive keeps their own; otherwise the pool.
  if nullif(p ->> 'assigned_to', '') is not null and (v_role in ('sales_manager', 'admin') or v_role is null) then
    v_assignee := (p ->> 'assigned_to')::uuid;
    if not exists (select 1 from public.staff where id = v_assignee and active and role in ('sales_executive', 'sales_manager')) then
      perform private.fail('invalid_input', 'assigned_to');
    end if;
    v_method := 'manual';
  elsif v_role = 'sales_executive' then
    v_assignee := v_me;
    v_method := 'self';
  else
    v_assignee := private.next_assignee(v_source);
    v_method := 'round_robin';
  end if;

  -- Exactly one patient with this number → linked straight away.
  select case when count(*) = 1 then min(pt.id::text)::uuid end into v_patient
  from public.patients pt
  where pt.merged_into_id is null and pt.phone_last10 = right(p ->> 'phone', 10);

  insert into public.leads (
    id, lead_date, name, phone_e164, alt_phone_e164, email, treatment_template_id, treatment_text, assigned_to, assigned_at,
    doctor_id, source_id, source_detail, meta_leadgen_id, referred_by_text, referred_by_staff_id, appointment_mode,
    surgery_date, amount_quoted_paise, amount_finalised_paise, amount_finalised_by, amount_finalised_at,
    comments1, comments2, stage, lost_reason_id, patient_id, duplicate_of_id, created_via)
  values (
    p_id, coalesce((p ->> 'lead_date')::date, (private.ist(now()))::date), btrim(p ->> 'name'),
    nullif(p ->> 'phone', ''), nullif(p ->> 'alt_phone', ''), nullif(btrim(p ->> 'email'), ''),
    (p ->> 'treatment_template_id')::uuid, nullif(btrim(p ->> 'treatment_text'), ''),
    v_assignee, case when v_assignee is not null then now() end,
    (p ->> 'doctor_id')::uuid, v_source, coalesce(p -> 'source_detail', '{}'::jsonb), nullif(p ->> 'meta_leadgen_id', ''),
    nullif(btrim(p ->> 'referred_by_text'), ''), (p ->> 'referred_by_staff_id')::uuid,
    (p ->> 'appointment_mode')::public.appt_mode, (p ->> 'surgery_date')::date,
    (p ->> 'amount_quoted_paise')::bigint,
    (p ->> 'amount_finalised_paise')::bigint,
    case when p ? 'amount_finalised_paise' then v_me end, case when p ? 'amount_finalised_paise' then now() end,
    nullif(btrim(p ->> 'comments1'), ''), nullif(btrim(p ->> 'comments2'), ''),
    coalesce((p ->> 'stage')::public.lead_stage, 'new'), (p ->> 'lost_reason_id')::uuid,
    v_patient, (p ->> 'duplicate_of_id')::uuid, p_via)
  returning * into v_row;

  perform private.lead_log(v_row.id, 'created', null, jsonb_build_object('via', p_via));
  if v_assignee is not null then
    insert into public.lead_assignments (lead_id, from_staff, to_staff, by_staff, method)
    values (v_row.id, null, v_assignee, v_me, v_method);
    perform private.notify_staff(v_assignee, 'lead_assigned', 'New lead: ' || v_row.name, v_row.phone_e164,
                                 '/leads/' || v_row.id, 'lead_assigned:' || v_row.id || ':' || v_assignee);
  else
    -- Nobody to take it: every sales manager hears about it.
    insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
    select s.id, 'lead_unassigned', 'Unassigned lead: ' || v_row.name, v_row.phone_e164, '/leads/' || v_row.id,
           'lead_unassigned:' || v_row.id || ':' || s.id
    from public.staff s where s.active and s.role = 'sales_manager' and s.id is distinct from v_me
    on conflict (dedupe_key) do nothing;
  end if;
  if v_row.duplicate_of_id is not null then
    perform private.lead_log(v_row.duplicate_of_id, 'duplicate', null,
                             jsonb_build_object('lead_id', v_row.id, 'sl_no', v_row.sl_no, 'via', p_via));
  end if;
  -- New leads are called first: a follow-up for the owner right now.
  if v_row.stage = 'new' then
    perform private.set_lead_followup(v_row.id, coalesce((p ->> 'next_followup_at')::timestamptz, now()));
  elsif p ? 'next_followup_at' then
    perform private.set_lead_followup(v_row.id, (p ->> 'next_followup_at')::timestamptz);
  end if;
  select * into v_row from public.leads where id = v_row.id;
  return v_row;
end;
$$;

-- Desk / phone: first call shows duplicates (same number) without saving; "force" saves a new
-- lead linked to the most recent duplicate.
create function public.create_lead(p_lead jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
  v_dups jsonb;
  v_row public.leads;
  v_via text;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]);
  v_role := private.my_role();
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  if exists (select 1 from public.leads where id = p_client_id) then
    return jsonb_build_object('created', true, 'repeat', true, 'lead', private.lead_card(p_client_id));
  end if;
  if length(btrim(coalesce(p_lead ->> 'name', ''))) = 0 then
    perform private.fail('invalid_input', 'name');
  end if;
  if coalesce(p_lead ->> 'phone', '') !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.fail('invalid_input', 'phone');
  end if;
  if (p_lead ->> 'stage') = 'lost' and nullif(p_lead ->> 'lost_reason_id', '') is null then
    perform private.fail('reason_required', 'lost reason');
  end if;
  v_dups := private.lead_duplicates(p_lead ->> 'phone', p_lead ->> 'alt_phone', null);
  if jsonb_array_length(v_dups) > 0 and not coalesce((p_lead ->> 'force')::boolean, false) then
    return jsonb_build_object('created', false, 'duplicates', v_dups);
  end if;
  v_via := case v_role when 'receptionist' then 'reception' when 'bdm' then 'bdm'
                       else case when p_lead ->> 'via' = 'android' then 'android' else 'web' end end;
  v_row := private.lead_insert(
    (p_lead - 'meta_leadgen_id' - 'amount_finalised_paise')
      || case when jsonb_array_length(v_dups) > 0 then jsonb_build_object('duplicate_of_id', v_dups -> 0 ->> 'id') else '{}'::jsonb end,
    p_client_id, v_via);
  return jsonb_build_object('created', true, 'repeat', false, 'lead', private.lead_card(v_row.id), 'duplicates', v_dups);
exception
  when invalid_text_representation or check_violation or not_null_violation then
    perform private.fail('invalid_input');
end;
$$;

------------------------------------------------------------------------------
-- Edit (inline from the table, or the detail page)
------------------------------------------------------------------------------
create function public.update_lead(p_id uuid, p_patch jsonb, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.leads;
  v_new public.leads;
  v_changed text[];
  v_allowed text[] := array['name', 'phone', 'alt_phone', 'email', 'treatment_template_id', 'treatment_text', 'doctor_id',
                            'source_id', 'source_detail', 'referred_by_text', 'referred_by_staff_id', 'appointment_mode',
                            'surgery_date', 'next_followup_at', 'amount_quoted_paise', 'comments1', 'comments2',
                            'reminder_on', 'wa_mode', 'lead_date'];
  v_bad text;
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_old := private.lead_for(p_id, true);
  if v_old.version <> p_version then
    perform private.fail('stale_version');
  end if;
  select k into v_bad from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where not (k = any (v_allowed)) limit 1;
  if v_bad is not null then
    perform private.fail('invalid_input', v_bad);
  end if;
  if p_patch ? 'lead_date' and not private.has_role('sales_manager', 'admin') then
    perform private.fail('not_allowed', 'lead_date');
  end if;
  if p_patch ? 'phone' and coalesce(p_patch ->> 'phone', '') !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.fail('invalid_input', 'phone');
  end if;

  update public.leads l set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else l.name end,
    phone_e164 = case when p_patch ? 'phone' then p_patch ->> 'phone' else l.phone_e164 end,
    alt_phone_e164 = case when p_patch ? 'alt_phone' then nullif(p_patch ->> 'alt_phone', '') else l.alt_phone_e164 end,
    email = case when p_patch ? 'email' then nullif(btrim(p_patch ->> 'email'), '') else l.email end,
    treatment_template_id = case when p_patch ? 'treatment_template_id' then (p_patch ->> 'treatment_template_id')::uuid else l.treatment_template_id end,
    treatment_text = case when p_patch ? 'treatment_text' then nullif(btrim(p_patch ->> 'treatment_text'), '') else l.treatment_text end,
    doctor_id = case when p_patch ? 'doctor_id' then (p_patch ->> 'doctor_id')::uuid else l.doctor_id end,
    source_id = case when p_patch ? 'source_id' then (p_patch ->> 'source_id')::uuid else l.source_id end,
    source_detail = case when p_patch ? 'source_detail' then coalesce(p_patch -> 'source_detail', '{}'::jsonb) else l.source_detail end,
    referred_by_text = case when p_patch ? 'referred_by_text' then nullif(btrim(p_patch ->> 'referred_by_text'), '') else l.referred_by_text end,
    referred_by_staff_id = case when p_patch ? 'referred_by_staff_id' then (p_patch ->> 'referred_by_staff_id')::uuid else l.referred_by_staff_id end,
    appointment_mode = case when p_patch ? 'appointment_mode' then (p_patch ->> 'appointment_mode')::public.appt_mode else l.appointment_mode end,
    surgery_date = case when p_patch ? 'surgery_date' then (p_patch ->> 'surgery_date')::date else l.surgery_date end,
    amount_quoted_paise = case when p_patch ? 'amount_quoted_paise' then (p_patch ->> 'amount_quoted_paise')::bigint else l.amount_quoted_paise end,
    comments1 = case when p_patch ? 'comments1' then nullif(btrim(p_patch ->> 'comments1'), '') else l.comments1 end,
    comments2 = case when p_patch ? 'comments2' then nullif(btrim(p_patch ->> 'comments2'), '') else l.comments2 end,
    reminder_on = case when p_patch ? 'reminder_on' then coalesce((p_patch ->> 'reminder_on')::boolean, true) else l.reminder_on end,
    wa_mode = case when p_patch ? 'wa_mode' then p_patch ->> 'wa_mode' else l.wa_mode end,
    lead_date = case when p_patch ? 'lead_date' then (p_patch ->> 'lead_date')::date else l.lead_date end,
    last_activity_at = now(),
    version = l.version + 1
  where l.id = p_id
  returning * into v_new;

  if v_new.source_id is distinct from v_old.source_id
     and not exists (select 1 from public.lookup_values where id = v_new.source_id and kind = 'lead_source') then
    perform private.fail('invalid_input', 'source_id');
  end if;
  if p_patch ? 'next_followup_at' then
    perform private.set_lead_followup(p_id, (p_patch ->> 'next_followup_at')::timestamptz);
  end if;
  if v_new.surgery_date is not null and v_old.surgery_date is null then
    perform private.lead_auto_stage(p_id, 'surgery_scheduled', jsonb_build_object('surgery_date', v_new.surgery_date));
  end if;
  select array_agg(n.key order by n.key) into v_changed
  from jsonb_each(to_jsonb(v_new)) n join jsonb_each(to_jsonb(v_old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('version', 'updated_at', 'updated_by', 'last_activity_at', 'phone_last10', 'alt_phone_last10');
  if v_changed is not null then
    perform private.lead_log(p_id, 'edit', null, jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return private.lead_card(p_id);
exception
  when invalid_text_representation or check_violation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

create function private.lead_set_stage(p_id uuid, p_stage public.lead_stage, p_lost_reason_id uuid, p_note text,
                                       p_recording_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.lead_stage;
begin
  select stage into v_from from public.leads where id = p_id for update;
  if p_stage = 'lost' and p_lost_reason_id is null then
    perform private.fail('reason_required', 'lost reason');
  end if;
  if p_stage = 'lost' and not exists (select 1 from public.lookup_values where id = p_lost_reason_id and kind = 'lost_reason') then
    perform private.fail('invalid_input', 'lost reason');
  end if;
  if v_from = p_stage and p_stage <> 'lost' then
    return;
  end if;
  update public.leads set
    stage = p_stage,
    lost_reason_id = case when p_stage = 'lost' then p_lost_reason_id end,
    lost_recording_id = case when p_stage = 'lost' then coalesce(p_recording_id, lost_recording_id) end,
    last_activity_at = now(),
    version = version + 1
  where id = p_id;
  perform private.lead_log(p_id, 'stage', p_note,
                           jsonb_build_object('from', v_from, 'to', p_stage, 'lost_reason_id', p_lost_reason_id));
  if p_stage in ('lost', 'junk', 'converted') then
    perform private.set_lead_followup(p_id, null);
  end if;
  if p_lost_reason_id is not null then
    perform private.library_used('lookup_values', p_lost_reason_id);
  end if;
end;
$$;

create function public.set_lead_stage(p_id uuid, p_stage public.lead_stage, p_lost_reason_id uuid default null,
                                      p_note text default null, p_recording_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  perform private.lead_for(p_id, true);
  perform private.lead_set_stage(p_id, p_stage, p_lost_reason_id, p_note, p_recording_id);
  return private.lead_card(p_id);
end;
$$;

-- "Amount finalised" (the price agreed with the patient). Once a treatment has started for the
-- lead, sales can no longer change it; reception and admin can, with a reason.
create function public.set_amount_finalised(p_id uuid, p_amount_paise bigint, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.leads;
  v_locked boolean;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_row := private.lead_for(p_id, true, true);
  if p_amount_paise is not null and p_amount_paise < 0 then
    perform private.fail('invalid_input', 'amount');
  end if;
  v_locked := exists (select 1 from public.patient_treatments t where t.lead_id = p_id and t.status <> 'cancelled');
  if v_locked and private.has_role('sales_executive', 'sales_manager') then
    perform private.fail('amount_locked');
  end if;
  if v_locked and length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required', 'amount after the treatment started');
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update public.leads set
    amount_finalised_paise = p_amount_paise,
    amount_finalised_by = private.my_staff_id(),
    amount_finalised_at = now(),
    last_activity_at = now(),
    version = version + 1
  where id = p_id;
  perform private.lead_log(p_id, 'amount', p_reason,
                           jsonb_build_object('from', v_row.amount_finalised_paise, 'to', p_amount_paise));
  return private.lead_card(p_id);
end;
$$;

create function public.assign_leads(p_ids uuid[], p_to uuid, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  v_n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    perform private.fail('invalid_input', 'between 1 and 500 leads');
  end if;
  if not exists (select 1 from public.staff where id = p_to and active and role in ('sales_executive', 'sales_manager')) then
    perform private.fail('invalid_input', 'assignee');
  end if;
  with cur as (
    select l.id, l.assigned_to from public.leads l
    where l.id = any (p_ids) and l.deleted_at is null and l.assigned_to is distinct from p_to
    order by l.id
    for update
  ), upd as (
    update public.leads l set assigned_to = p_to, assigned_at = now(), last_activity_at = now(), version = l.version + 1
    from cur where l.id = cur.id
    returning l.id, cur.assigned_to as from_staff
  ), hist as (
    insert into public.lead_assignments (lead_id, from_staff, to_staff, by_staff, method, reason)
    select u.id, u.from_staff, p_to, v_me, 'manual', nullif(btrim(p_reason), '') from upd u
    returning lead_id, from_staff
  )
  insert into public.lead_activities (lead_id, staff_id, kind, body, data)
  select h.lead_id, v_me, 'assigned', nullif(btrim(p_reason), ''), jsonb_build_object('from', h.from_staff, 'to', p_to)
  from hist h;
  get diagnostics v_n = row_count;
  -- Their open sales tasks move with them.
  update public.followups set assigned_to = p_to
   where lead_id = any (p_ids) and status = 'open' and (source = 'sales' or kind = 'call_to_confirm')
     and assigned_to is distinct from p_to;
  if v_n > 0 then
    perform private.notify_staff(p_to, 'lead_assigned',
                                 case when v_n = 1 then '1 lead assigned to you' else v_n || ' leads assigned to you' end,
                                 nullif(btrim(p_reason), ''), '/leads', 'leads_assigned:' || p_to || ':' || txid_current());
  end if;
  return v_n;
end;
$$;

create function public.delete_lead(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  perform private.lead_for(p_id, true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  perform set_config('app.reason', btrim(p_reason), true);
  perform private.set_lead_followup(p_id, null);
  update public.leads set deleted_at = now(), deleted_reason = btrim(p_reason), version = version + 1 where id = p_id;
  perform private.lead_log(p_id, 'deleted', p_reason);
end;
$$;

create function public.add_lead_note(p_id uuid, p_body text, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  if p_client_id is null or length(btrim(coalesce(p_body, ''))) = 0 then
    perform private.fail('invalid_input', 'note');
  end if;
  perform private.lead_for(p_id);
  if not exists (select 1 from public.lead_activities where id = p_client_id) then
    perform private.lead_log(p_id, 'note', left(p_body, 4000), '{}'::jsonb, p_client_id);
    update public.leads set last_activity_at = now() where id = p_id;
  end if;
  return (select to_jsonb(a) from public.lead_activities a where a.id = p_client_id);
end;
$$;

-- Reception (or sales) links a lead to the patient record made for them. Their bookings,
-- tasks and calls follow.
create function public.link_lead_to_patient(p_lead_id uuid, p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
begin
  perform private.require_staff(array['receptionist', 'sales_manager', 'admin']::public.staff_role[]);
  v_lead := private.lead_for(p_lead_id, true, true);
  if not exists (select 1 from public.patients where id = p_patient_id and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
  end if;
  if v_lead.patient_id is not distinct from p_patient_id then
    return private.lead_card(p_lead_id);
  end if;
  update public.leads set patient_id = p_patient_id, last_activity_at = now(), version = version + 1 where id = p_lead_id;
  update public.patients set lead_id = p_lead_id where id = p_patient_id and lead_id is null;
  update public.appointments set patient_id = p_patient_id where lead_id = p_lead_id and patient_id is null;
  insert into public.visits (patient_id, appointment_id, doctor_id, visit_date)
  select p_patient_id, a.id, a.doctor_id, a.appt_date from public.appointments a
  where a.lead_id = p_lead_id and a.patient_id = p_patient_id and a.status in ('arrived', 'with_doctor', 'done')
  on conflict (appointment_id) do nothing;
  update public.followups set patient_id = p_patient_id where lead_id = p_lead_id and patient_id is null;
  update public.call_logs set patient_id = p_patient_id where lead_id = p_lead_id and patient_id is null;
  perform private.lead_log(p_lead_id, 'linked', null, jsonb_build_object('patient_id', p_patient_id));
  return private.lead_card(p_lead_id);
end;
$$;

------------------------------------------------------------------------------
-- Calls (the phone app; the web logs calls too)
------------------------------------------------------------------------------
-- p: {client_id, lead_id?, phone, direction, started_at, duration_s, outcome, notes, next_followup_at?,
--     stage?, lost_reason_id?, device_call_key?}
create function public.log_call(p_call jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_id uuid := (p_call ->> 'client_id')::uuid;
  v_lead public.leads;
  v_row public.call_logs;
  v_outcome public.call_outcome := (p_call ->> 'outcome')::public.call_outcome;
  v_phone text := nullif(p_call ->> 'phone', '');
begin
  if v_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  select * into v_row from public.call_logs where id = v_id;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;
  if nullif(p_call ->> 'lead_id', '') is not null then
    v_lead := private.lead_for((p_call ->> 'lead_id')::uuid, true);
  elsif v_phone is not null then
    select * into v_lead from public.leads l
     where l.deleted_at is null and (l.phone_last10 = right(v_phone, 10) or l.alt_phone_last10 = right(v_phone, 10))
       and (private.has_role('sales_manager', 'admin') or l.assigned_to = v_me)
     order by l.created_at desc limit 1;
  end if;

  insert into public.call_logs (id, staff_id, lead_id, patient_id, phone_e164, direction, started_at, duration_s, outcome,
                                notes, source, device_call_key)
  values (v_id, v_me, v_lead.id, v_lead.patient_id, coalesce(v_phone, v_lead.phone_e164),
          coalesce((p_call ->> 'direction')::public.call_direction, 'outgoing'),
          coalesce((p_call ->> 'started_at')::timestamptz, now()),
          coalesce((p_call ->> 'duration_s')::int, 0), v_outcome, nullif(btrim(p_call ->> 'notes'), ''), 'app',
          nullif(p_call ->> 'device_call_key', ''))
  on conflict do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.call_logs where id = v_id or (staff_id = v_me and device_call_key = p_call ->> 'device_call_key');
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;

  if v_lead.id is not null then
    update public.leads set last_activity_at = now(), first_call_at = coalesce(first_call_at, v_row.started_at)
     where id = v_lead.id;
    perform private.lead_log(v_lead.id, 'call', v_row.notes,
      jsonb_build_object('call_id', v_row.id, 'direction', v_row.direction, 'outcome', v_row.outcome, 'duration_s', v_row.duration_s));
    if v_outcome = 'connected' and v_lead.stage in ('new', 'not_reachable') then
      perform private.lead_auto_stage(v_lead.id, 'contacted');
    end if;
    if nullif(p_call ->> 'stage', '') is not null then
      perform private.lead_set_stage(v_lead.id, (p_call ->> 'stage')::public.lead_stage, (p_call ->> 'lost_reason_id')::uuid,
                                     null, null);
    end if;
    if p_call ? 'next_followup_at' then
      perform private.set_lead_followup(v_lead.id, (p_call ->> 'next_followup_at')::timestamptz);
    else
      -- The call was the follow-up that was due: close it.
      update public.followups set status = 'done', done_at = now(), done_by = v_me, outcome = coalesce(v_outcome::text, 'called')
       where kind = 'followup' and ref_table = 'leads' and ref_id = v_lead.id and status = 'open' and due_at <= now();
      update public.leads set next_followup_at = null where id = v_lead.id and next_followup_at <= now();
    end if;
  end if;
  return to_jsonb(v_row) || jsonb_build_object('repeat', false, 'lead', case when v_lead.id is not null then private.lead_card(v_lead.id) end);
exception
  when invalid_text_representation or check_violation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

-- The phone's call log: only calls with CRM numbers (the caller's visible leads) are kept;
-- the rest never leave the phone. Idempotent per (staff, device_call_key). ≤ 500 rows.
-- rows: [{client_id?, device_call_key, phone, direction, started_at, duration_s}]
create function public.import_call_log(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager']::public.staff_role[]);
  v_all boolean := private.has_role('sales_manager');
  v_total integer;
  v_n integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    perform private.fail('invalid_input', 'at most 500 rows per batch');
  end if;
  v_total := jsonb_array_length(p_rows);
  with r as (
    select (e ->> 'device_call_key') as key, e ->> 'phone' as phone, (e ->> 'direction')::public.call_direction as direction,
           (e ->> 'started_at')::timestamptz as started_at, greatest(coalesce((e ->> 'duration_s')::int, 0), 0) as duration_s,
           coalesce((e ->> 'client_id')::uuid, gen_random_uuid()) as id
    from jsonb_array_elements(p_rows) e
    where nullif(e ->> 'device_call_key', '') is not null and coalesce(e ->> 'phone', '') ~ '^\+[1-9][0-9]{7,14}$'
  ), matched as (
    select r.*, m.lead_id, m.patient_id
    from r
    join lateral (
      select l.id as lead_id, l.patient_id from public.leads l
      where l.deleted_at is null and (v_all or l.assigned_to = v_me)
        and (l.phone_last10 = right(r.phone, 10) or l.alt_phone_last10 = right(r.phone, 10))
      order by l.created_at desc limit 1
    ) m on true
  ), ins as (
    insert into public.call_logs (id, staff_id, lead_id, patient_id, phone_e164, direction, started_at, duration_s, outcome,
                                  source, device_call_key)
    select m.id, v_me, m.lead_id, m.patient_id, m.phone, m.direction, m.started_at, m.duration_s,
           case when m.direction = 'missed' then null when m.duration_s > 0 then 'connected' else 'no_answer' end::public.call_outcome,
           'call_log', m.key
    from matched m
    on conflict do nothing
    returning lead_id, started_at, outcome
  ), touched as (
    update public.leads l set last_activity_at = greatest(l.last_activity_at, x.last_at),
                              first_call_at = least(coalesce(l.first_call_at, x.first_at), x.first_at)
    from (select lead_id, min(started_at) as first_at, max(started_at) as last_at from ins group by lead_id) x
    where l.id = x.lead_id
    returning l.id
  )
  select count(*) into v_n from ins;
  return jsonb_build_object('inserted', v_n, 'skipped', v_total - v_n);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

------------------------------------------------------------------------------
-- Reads
------------------------------------------------------------------------------
-- For sales: the patient made from a lead (only these fields; PLAN.md C7 "rpc").
create function public.lead_patient_summary(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_lead := private.lead_for(p_lead_id, false, true);
  if v_lead.patient_id is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'patient_id', p.id, 'name', p.full_name, 'uhid', p.uhid,
      'upcoming', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'slot_start', a.slot_start, 'status', a.status,
                                            'doctor', coalesce(d.display_name, d.full_name)) order by a.slot_start)
        from (select * from public.appointments a
              where a.patient_id = p.id and a.slot_start >= now() and a.status in ('pending_confirmation', 'confirmed')
              order by a.slot_start limit 5) a
        left join public.doctors d on d.id = a.doctor_id), '[]'::jsonb),
      'last_visit', (select max(v.visit_date) from public.visits v where v.patient_id = p.id),
      'treatment', (select jsonb_build_object('name', t.name, 'status', t.status, 'agreed_price_paise', t.agreed_price_paise,
                                              'start_date', t.start_date)
                    from public.patient_treatments t where t.patient_id = p.id and t.status <> 'cancelled'
                    order by (t.lead_id = p_lead_id) desc nulls last, t.start_date desc limit 1),
      'agreed_price_paise', v_lead.amount_finalised_paise)
    from public.patients p where p.id = v_lead.patient_id);
end;
$$;

create function public.lead_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_lead := private.lead_for(p_id);
  return private.lead_card(p_id) || jsonb_build_object(
    'patient', public.lead_patient_summary(p_id),
    'duplicates', private.lead_duplicates(v_lead.phone_e164, v_lead.alt_phone_e164, p_id),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'slot_start', a.slot_start, 'status', a.status, 'type', a.type,
                                          'mode', a.mode, 'version', a.version, 'doctor_id', a.doctor_id,
                                          'doctor', coalesce(d.display_name, d.full_name)) order by a.slot_start desc)
      from (select * from public.appointments a where a.lead_id = p_id and a.status <> 'rescheduled'
            order by a.slot_start desc nulls last limit 20) a
      left join public.doctors d on d.id = a.doctor_id), '[]'::jsonb),
    'followups', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'due_date', f.due_date, 'due_at', f.due_at,
                                          'reason', f.reason, 'assigned_to', f.assigned_to) order by f.due_date)
      from public.followups f where f.lead_id = p_id and f.status = 'open'), '[]'::jsonb),
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'started_at', c.started_at, 'direction', c.direction,
                                          'duration_s', c.duration_s, 'outcome', c.outcome, 'notes', c.notes,
                                          'staff_name', s.full_name) order by c.started_at desc)
      from (select * from public.call_logs c where c.lead_id = p_id order by c.started_at desc limit 10) c
      left join public.staff s on s.id = c.staff_id), '[]'::jsonb));
end;
$$;

-- Newest first, keyset on (at, id).
create function public.lead_activities(p_id uuid, p_cursor text default null, p_limit integer default 20)
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
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  perform private.lead_for(p_id);
  select coalesce(jsonb_agg(x.card order by x.at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select to_jsonb(a) || jsonb_build_object('staff_name', s.full_name) as card, a.at, a.id
    from public.lead_activities a left join public.staff s on s.id = a.staff_id
    where a.lead_id = p_id
      and (v_c is null or (a.at, a.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by a.at desc, a.id desc
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'at', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

-- Reception: the leads behind a patient (patient file, "agreed with sales" in Start treatment).
create function public.patient_leads(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'sl_no', l.sl_no, 'name', l.name, 'stage', l.stage, 'lead_date', l.lead_date,
             'assigned_name', s.full_name, 'amount_finalised_paise', l.amount_finalised_paise,
             'amount_finalised_at', l.amount_finalised_at, 'finalised_by_name', f.full_name,
             'treatment', coalesce(tt.name, l.treatment_text)) order by l.created_at desc)
    from public.leads l
    left join public.staff s on s.id = l.assigned_to
    left join public.staff f on f.id = l.amount_finalised_by
    left join public.treatment_templates tt on tt.id = l.treatment_template_id
    where l.patient_id = p_patient_id and l.deleted_at is null), '[]'::jsonb);
end;
$$;

-- Reception registering a lead who came in: what the patient form starts from.
create function public.lead_for_registration(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return (select jsonb_build_object('id', l.id, 'sl_no', l.sl_no, 'full_name', l.name, 'phone_e164', l.phone_e164,
                                    'alt_phone_e164', l.alt_phone_e164, 'email', l.email, 'patient_id', l.patient_id,
                                    'referred_by_text', l.referred_by_text)
          from public.leads l where l.id = p_lead_id and l.deleted_at is null);
end;
$$;

-- The filtered set behind the manager table and the export (inlined by the planner).
-- Without a search or a due filter the lead date range applies (the RPCs cap it at a year).
create function private.leads_filtered(
  p_q text, p_digits text, p_stages public.lead_stage[], p_assignee uuid, p_unassigned boolean, p_sources uuid[],
  p_from date, p_to date, p_due text, p_only uuid, p_doctor uuid, p_treatment uuid)
returns setof public.leads
language sql
stable
as $$
  select l.* from public.leads l
  where l.deleted_at is null
    and (p_only is null or l.assigned_to = p_only)
    and (p_stages is null or l.stage = any (p_stages))
    and (p_assignee is null or l.assigned_to = p_assignee)
    and (not p_unassigned or l.assigned_to is null)
    and (p_sources is null or l.source_id = any (p_sources))
    and (p_doctor is null or l.doctor_id = p_doctor)
    and (p_treatment is null or l.treatment_template_id = p_treatment)
    and (p_q is not null or p_due is not null or l.lead_date between p_from and p_to)
    and (p_due is null
         or (p_due = 'overdue' and l.next_followup_at < now())
         or (p_due = 'today' and l.next_followup_at >= private.ist_at((private.ist(now()))::date, '00:00')
                              and l.next_followup_at < private.ist_at((private.ist(now()))::date + 1, '00:00'))
         or (p_due = 'none' and l.next_followup_at is null and l.stage not in ('converted', 'lost', 'junk')))
    and (p_q is null
         or l.name ilike '%' || private.like_escape(p_q) || '%'
         or (length(p_digits) >= 4 and (l.phone_last10 like '%' || right(p_digits, 10)
                                        or l.alt_phone_last10 like '%' || right(p_digits, 10)))
         or (p_digits = p_q and length(p_digits) between 1 and 9 and l.sl_no = p_digits::bigint));
$$;

create function private.leads_filter_args(p_filters jsonb)
returns table (q text, digits text, stages public.lead_stage[], assignee uuid, unassigned boolean, sources uuid[],
               d_from date, d_to date, due text, doctor uuid, treatment uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (private.ist(now()))::date;
  v_q text := nullif(btrim(coalesce(p_filters ->> 'q', '')), '');
begin
  q := case when length(v_q) >= 1 then v_q end;
  digits := regexp_replace(coalesce(v_q, ''), '\D', '', 'g');
  stages := case when p_filters ? 'stages' and jsonb_array_length(p_filters -> 'stages') > 0
                 then array(select jsonb_array_elements_text(p_filters -> 'stages'))::public.lead_stage[] end;
  unassigned := coalesce(p_filters ->> 'assigned_to', '') = 'unassigned';
  assignee := case when p_filters ->> 'assigned_to' ~ '^[0-9a-f-]{36}$' then (p_filters ->> 'assigned_to')::uuid end;
  sources := case when p_filters ? 'source_ids' and jsonb_array_length(p_filters -> 'source_ids') > 0
                  then array(select jsonb_array_elements_text(p_filters -> 'source_ids'))::uuid[] end;
  d_to := coalesce((p_filters ->> 'to')::date, v_today);
  d_from := coalesce((p_filters ->> 'from')::date, d_to - 89);
  due := nullif(p_filters ->> 'due', '');
  doctor := (p_filters ->> 'doctor_id')::uuid;
  treatment := (p_filters ->> 'treatment_template_id')::uuid;
  if d_to < d_from or d_to - d_from > 366 then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  if due is not null and due not in ('overdue', 'today', 'none') then
    perform private.fail('invalid_input', 'due');
  end if;
  return next;
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input', 'filters');
end;
$$;

-- Managers / admin: every lead. Executives: their own (forced). Offset paging, exact count, ≤ 100.
create function public.leads_table(p_filters jsonb default '{}', p_sort text default 'lead_date', p_desc boolean default true,
                                   p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_only uuid := case when private.has_role('sales_executive') then v_me end;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  a record;
  v_order text := case p_sort
    when 'sl_no' then 'f.sl_no' when 'name' then 'lower(f.name)' when 'stage' then 'f.stage::text'
    when 'next_followup_at' then 'f.next_followup_at' when 'last_activity_at' then 'f.last_activity_at'
    when 'amount_finalised_paise' then 'f.amount_finalised_paise' when 'assigned' then 's.full_name'
    else 'f.lead_date' end;
  v_result jsonb;
begin
  select * into a from private.leads_filter_args(coalesce(p_filters, '{}'::jsonb));
  execute format($q$
    with f as (
      select * from private.leads_filtered($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', coalesce((
        select jsonb_agg(x.card order by x.ord)
        from (
          select to_jsonb(f) || jsonb_build_object(
                   'assigned_name', s.full_name, 'source_label', src.label, 'treatment', coalesce(tt.name, f.treatment_text),
                   'doctor_name', coalesce(d.display_name, d.full_name), 'lost_reason', lr.label, 'uhid', p.uhid,
                   'amount_locked', exists (select 1 from public.patient_treatments t where t.lead_id = f.id and t.status <> 'cancelled')) as card,
                 row_number() over (order by %s %s nulls last, f.sl_no desc) as ord
          from f
          left join public.staff s on s.id = f.assigned_to
          left join public.lookup_values src on src.id = f.source_id
          left join public.treatment_templates tt on tt.id = f.treatment_template_id
          left join public.doctors d on d.id = f.doctor_id
          left join public.lookup_values lr on lr.id = f.lost_reason_id
          left join public.patients p on p.id = f.patient_id
          order by %s %s nulls last, f.sl_no desc
          limit $13 offset $14) x), '[]'::jsonb))
  $q$, v_order, case when p_desc then 'desc' else 'asc' end, v_order, case when p_desc then 'desc' else 'asc' end)
  into v_result
  using a.q, a.digits, a.stages, a.assignee, a.unassigned, a.sources, a.d_from, a.d_to, a.due, v_only, a.doctor, a.treatment,
        v_limit, greatest(coalesce(p_offset, 0), 0);
  return v_result;
end;
$$;

-- Export (CSV on the web): the same filters, 1000 rows a page, keyset on Sl No (newest first).
create function public.leads_export(p_filters jsonb default '{}', p_cursor bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_only uuid := case when private.has_role('sales_executive') then v_me end;
  a record;
  v_rows jsonb;
begin
  select * into a from private.leads_filter_args(coalesce(p_filters, '{}'::jsonb));
  select coalesce(jsonb_agg(x.card order by x.sl_no desc), '[]'::jsonb) into v_rows
  from (
    select f.sl_no, jsonb_build_object(
             'sl_no', f.sl_no, 'lead_date', f.lead_date, 'name', f.name, 'phone', f.phone_e164, 'alt_phone', f.alt_phone_e164,
             'email', f.email, 'treatment', coalesce(tt.name, f.treatment_text), 'assigned', s.full_name,
             'doctor', coalesce(d.display_name, d.full_name), 'source', src.label, 'referred_by', f.referred_by_text,
             'appointment_mode', f.appointment_mode, 'surgery_date', f.surgery_date, 'next_followup_at', f.next_followup_at,
             'amount_quoted_paise', f.amount_quoted_paise, 'amount_finalised_paise', f.amount_finalised_paise,
             'stage', f.stage, 'lost_reason', lr.label, 'comments1', f.comments1, 'comments2', f.comments2,
             'uhid', p.uhid) as card
    from private.leads_filtered(a.q, a.digits, a.stages, a.assignee, a.unassigned, a.sources, a.d_from, a.d_to, a.due,
                                v_only, a.doctor, a.treatment) f
    left join public.staff s on s.id = f.assigned_to
    left join public.lookup_values src on src.id = f.source_id
    left join public.treatment_templates tt on tt.id = f.treatment_template_id
    left join public.doctors d on d.id = f.doctor_id
    left join public.lookup_values lr on lr.id = f.lost_reason_id
    left join public.patients p on p.id = f.patient_id
    where p_cursor is null or f.sl_no < p_cursor
    order by f.sl_no desc
    limit 1001) x;
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
               from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= 1000),
    'next_cursor', case when jsonb_array_length(v_rows) > 1000 then (v_rows -> 999 ->> 'sl_no')::bigint end);
end;
$$;

------------------------------------------------------------------------------
-- Round-robin pool (managers and admin)
------------------------------------------------------------------------------
create function public.lead_pool_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  return jsonb_build_object(
    'round_robin', coalesce((private.setting('sales', 'round_robin', 'true'))::boolean, true),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'staff_id', s.id, 'name', s.full_name, 'staff_active', s.active,
               'in_pool', p.staff_id is not null and p.active, 'source_ids', coalesce(p.source_ids, '{}'),
               'sort', coalesce(p.sort, 100), 'last_assigned_at', p.last_assigned_at,
               'open_leads', (select count(*) from public.leads l
                              where l.assigned_to = s.id and l.deleted_at is null
                                and l.stage not in ('converted', 'lost', 'junk')))
             order by coalesce(p.sort, 100), s.full_name)
      from public.staff s left join public.lead_pool p on p.staff_id = s.id
      where s.role = 'sales_executive'), '[]'::jsonb));
end;
$$;

-- members: [{staff_id, in_pool, source_ids, sort}]
create function public.save_lead_pool(p_members jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  if jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) > 200 then
    perform private.fail('invalid_input', 'members');
  end if;
  if exists (select 1 from jsonb_array_elements(p_members) m
             left join public.staff s on s.id = (m ->> 'staff_id')::uuid
             where s.id is null or s.role <> 'sales_executive') then
    perform private.fail('invalid_input', 'only sales executives take leads from the pool');
  end if;
  insert into public.lead_pool (staff_id, active, source_ids, sort)
  select (m ->> 'staff_id')::uuid, coalesce((m ->> 'in_pool')::boolean, true),
         coalesce(array(select jsonb_array_elements_text(m -> 'source_ids'))::uuid[], '{}'),
         coalesce((m ->> 'sort')::int, 100)
  from jsonb_array_elements(p_members) m
  on conflict (staff_id) do update
    set active = excluded.active, source_ids = excluded.source_ids, sort = excluded.sort;
  return public.lead_pool_list();
exception
  when invalid_text_representation then
    perform private.fail('invalid_input', 'members');
end;
$$;

------------------------------------------------------------------------------
-- CSV import (managers and admin). Up to 500 rows per call; dry_run checks without saving.
-- Rows (already mapped and phone-normalised by the web screen):
-- {name, phone, alt_phone?, email?, lead_date?, treatment?, source?, assigned?, referred_by?, comments1?,
--  comments2?, amount_quoted_paise?, amount_finalised_paise?, stage?, lost_reason?, next_followup_at?}
-- A number that already has a lead is skipped and reported (never merged or overwritten).
------------------------------------------------------------------------------
create function public.import_leads(p_rows jsonb, p_dry_run boolean default true)
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
  v_seen text[] := '{}';
  v_p jsonb;
  v_ref uuid;
  v_state text;
  v_detail text;
  v_message text;
  v_constraint text;
  v_column text;
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    perform private.fail('invalid_input', 'at most 500 rows per batch');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      if length(btrim(coalesce(v_row ->> 'name', ''))) = 0 then
        raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'name';
      end if;
      if coalesce(v_row ->> 'phone', '') !~ '^\+[1-9][0-9]{7,14}$' then
        raise exception using errcode = 'P0001', message = 'invalid_input', detail = 'phone';
      end if;
      if right(v_row ->> 'phone', 10) = any (v_seen)
         or exists (select 1 from public.leads l where l.deleted_at is null
                      and (l.phone_last10 = right(v_row ->> 'phone', 10) or l.alt_phone_last10 = right(v_row ->> 'phone', 10))) then
        raise exception using errcode = 'P0001', message = 'duplicate', detail = 'phone';
      end if;
      v_seen := v_seen || right(v_row ->> 'phone', 10);
      v_p := jsonb_strip_nulls(jsonb_build_object(
        'name', v_row ->> 'name', 'phone', v_row ->> 'phone', 'alt_phone', nullif(v_row ->> 'alt_phone', ''),
        'email', v_row ->> 'email', 'lead_date', nullif(v_row ->> 'lead_date', ''),
        'referred_by_text', v_row ->> 'referred_by', 'comments1', v_row ->> 'comments1', 'comments2', v_row ->> 'comments2',
        'amount_quoted_paise', v_row -> 'amount_quoted_paise', 'amount_finalised_paise', v_row -> 'amount_finalised_paise',
        'next_followup_at', nullif(v_row ->> 'next_followup_at', '')));
      if nullif(btrim(v_row ->> 'treatment'), '') is not null then
        select id into v_ref from public.treatment_templates where lower(name) = lower(btrim(v_row ->> 'treatment')) limit 1;
        v_p := v_p || case when v_ref is not null then jsonb_build_object('treatment_template_id', v_ref)
                           else jsonb_build_object('treatment_text', btrim(v_row ->> 'treatment')) end;
      end if;
      if nullif(btrim(v_row ->> 'source'), '') is not null then
        select id into v_ref from public.lookup_values
         where kind = 'lead_source' and merged_into_id is null
           and (lower(label) = lower(btrim(v_row ->> 'source')) or code = lower(btrim(v_row ->> 'source')));
        if v_ref is null then
          raise exception using errcode = 'P0001', message = 'not_found', detail = 'source';
        end if;
        v_p := v_p || jsonb_build_object('source_id', v_ref);
      end if;
      if nullif(btrim(v_row ->> 'assigned'), '') is not null then
        select id into v_ref from public.staff
         where active and role in ('sales_executive', 'sales_manager')
           and (lower(username) = lower(btrim(v_row ->> 'assigned')) or lower(full_name) = lower(btrim(v_row ->> 'assigned')))
         limit 1;
        if v_ref is null then
          raise exception using errcode = 'P0001', message = 'not_found', detail = 'assigned';
        end if;
        v_p := v_p || jsonb_build_object('assigned_to', v_ref);
      end if;
      if nullif(btrim(v_row ->> 'stage'), '') is not null then
        v_p := v_p || jsonb_build_object('stage', (lower(replace(btrim(v_row ->> 'stage'), ' ', '_')))::public.lead_stage);
        if v_p ->> 'stage' = 'lost' then
          select id into v_ref from public.lookup_values
           where kind = 'lost_reason' and merged_into_id is null and lower(label) = lower(btrim(coalesce(v_row ->> 'lost_reason', '')));
          if v_ref is null then
            raise exception using errcode = 'P0001', message = 'reason_required', detail = 'lost_reason';
          end if;
          v_p := v_p || jsonb_build_object('lost_reason_id', v_ref);
        end if;
      end if;
      if not p_dry_run then
        perform private.lead_insert(v_p, gen_random_uuid(), 'import');
      else
        -- Dry run: still check types and limits by inserting inside a sub-transaction that is undone.
        begin
          perform private.lead_insert(v_p - 'assigned_to', gen_random_uuid(), 'import');
          raise exception using errcode = 'PX001', message = 'dry_run_ok'; -- undo the trial insert
        exception when sqlstate 'PX001' then null;
        end;
      end if;
      v_ok := v_ok + 1;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_message = message_text,
                              v_constraint = constraint_name, v_column = column_name;
      -- private.import_error is defined by the import-checks migration (resolved when this runs).
      v_errors := v_errors || private.import_error(v_i, v_state, v_message, v_detail, v_constraint, v_column, array['leads']);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errors', v_errors, 'dry_run', p_dry_run);
end;
$$;

------------------------------------------------------------------------------
-- Meta Lead Ads (database side). The meta-leads Edge Function checks the signature, then:
--   meta_lead_received → (new?) → fetch the form answers from Meta → meta_lead_create.
-- A leadgen id is processed once; repeats are ignored. Service role only.
------------------------------------------------------------------------------
create function public.meta_lead_received(p_leadgen_id text, p_page_id text default null, p_form_id text default null,
                                          p_ad_id text default null, p_created_time timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.meta_lead_events;
  v_new boolean;
begin
  insert into public.meta_lead_events (leadgen_id, page_id, form_id, ad_id, meta_created_at)
  values (p_leadgen_id, p_page_id, p_form_id, p_ad_id, p_created_time)
  on conflict (leadgen_id) do nothing
  returning * into v_row;
  v_new := v_row.id is not null;
  if not v_new then
    select * into v_row from public.meta_lead_events where leadgen_id = p_leadgen_id for update;
  end if;
  update public.meta_lead_events set attempts = attempts + 1 where id = v_row.id and status in ('received', 'failed');
  -- Process when new, or when an earlier try failed; skip when a lead was already made.
  return jsonb_build_object('process', v_row.status in ('received', 'failed'), 'repeat', not v_new, 'status', v_row.status);
exception
  when check_violation then
    perform private.fail('invalid_input', 'leadgen id');
end;
$$;

-- p_lead: the mapped answers {name, phone (E.164), alt_phone?, email?, treatment_text?, comments1?, comments2?,
--          source_code ('facebook' | 'instagram'), source_detail {campaign, adset, ad, form, platform}}
-- p_raw: the original answers (kept 14 days for checking the mapping).
-- Same number as an open lead → no second lead: the existing one is told "enquired again".
create function public.meta_lead_create(p_leadgen_id text, p_lead jsonb, p_raw jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.meta_lead_events;
  v_open public.leads;
  v_dup uuid;
  v_row public.leads;
begin
  select * into v_event from public.meta_lead_events where leadgen_id = p_leadgen_id for update;
  if not found then
    perform private.fail('not_found', 'leadgen');
  end if;
  if v_event.status in ('created', 'duplicate') then
    return jsonb_build_object('status', v_event.status, 'lead_id', v_event.lead_id, 'repeat', true);
  end if;
  if coalesce(p_lead ->> 'phone', '') !~ '^\+[1-9][0-9]{7,14}$' or length(btrim(coalesce(p_lead ->> 'name', ''))) = 0 then
    update public.meta_lead_events set status = 'failed', error = 'name or phone missing', payload = p_raw, processed_at = now()
     where id = v_event.id;
    return jsonb_build_object('status', 'failed', 'error', 'name or phone missing');
  end if;

  select l.* into v_open from public.leads l
  where l.deleted_at is null and l.stage not in ('converted', 'lost', 'junk')
    and (l.phone_last10 = right(p_lead ->> 'phone', 10) or l.alt_phone_last10 = right(p_lead ->> 'phone', 10))
  order by l.created_at desc limit 1;
  if v_open.id is not null then
    insert into public.lead_activities (lead_id, kind, data)
    values (v_open.id, 'enquired_again', jsonb_build_object('leadgen_id', p_leadgen_id, 'source_detail', p_lead -> 'source_detail'));
    update public.leads set last_activity_at = now() where id = v_open.id;
    perform private.notify_staff(v_open.assigned_to, 'lead_enquired_again', 'Enquired again: ' || v_open.name,
                                 v_open.phone_e164, '/leads/' || v_open.id, 'lead_again:' || p_leadgen_id);
    update public.meta_lead_events set status = 'duplicate', lead_id = v_open.id, error = null, payload = p_raw,
                                       processed_at = now() where id = v_event.id;
    return jsonb_build_object('status', 'duplicate', 'lead_id', v_open.id);
  end if;

  -- A closed lead with this number: a new lead, linked to it.
  select l.id into v_dup from public.leads l
  where l.deleted_at is null
    and (l.phone_last10 = right(p_lead ->> 'phone', 10) or l.alt_phone_last10 = right(p_lead ->> 'phone', 10))
  order by l.created_at desc limit 1;
  v_row := private.lead_insert(
    jsonb_strip_nulls(jsonb_build_object(
      'name', left(btrim(p_lead ->> 'name'), 200), 'phone', p_lead ->> 'phone', 'alt_phone', p_lead ->> 'alt_phone',
      'email', left(p_lead ->> 'email', 200), 'treatment_text', left(p_lead ->> 'treatment_text', 200),
      'comments1', left(p_lead ->> 'comments1', 2000), 'comments2', left(p_lead ->> 'comments2', 2000),
      'source_code', coalesce(nullif(p_lead ->> 'source_code', ''), 'facebook'),
      'source_detail', coalesce(p_lead -> 'source_detail', '{}'::jsonb),
      'meta_leadgen_id', p_leadgen_id, 'duplicate_of_id', v_dup,
      'lead_date', (private.ist(coalesce(v_event.meta_created_at, now())))::date)),
    gen_random_uuid(), 'meta');
  update public.meta_lead_events set status = 'created', lead_id = v_row.id, error = null, payload = p_raw, processed_at = now()
   where id = v_event.id;
  return jsonb_build_object('status', 'created', 'lead_id', v_row.id, 'assigned_to', v_row.assigned_to);
end;
$$;

create function public.meta_lead_failed(p_leadgen_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.meta_lead_events set status = 'failed', error = left(p_error, 1000), processed_at = now()
  where leadgen_id = p_leadgen_id and status in ('received', 'failed');
$$;

revoke execute on function
  public.meta_lead_received(text, text, text, text, timestamptz),
  public.meta_lead_create(text, jsonb, jsonb),
  public.meta_lead_failed(text, text)
from public, anon, authenticated;
grant execute on function
  public.meta_lead_received(text, text, text, text, timestamptz),
  public.meta_lead_create(text, jsonb, jsonb),
  public.meta_lead_failed(text, text)
to service_role;

-- Admin: recent webhook deliveries (newest first, keyset) and a retry for failed ones.
create function public.meta_lead_events_list(p_cursor text default null, p_limit integer default 20)
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
  perform private.require_staff(array['admin']::public.staff_role[]);
  select coalesce(jsonb_agg(x.card order by x.received_at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object('id', e.id, 'leadgen_id', e.leadgen_id, 'form_id', e.form_id, 'status', e.status,
                              'error', e.error, 'attempts', e.attempts, 'received_at', e.received_at,
                              'lead_id', e.lead_id, 'lead_name', l.name, 'sl_no', l.sl_no) as card, e.received_at, e.id
    from public.meta_lead_events e left join public.leads l on l.id = e.lead_id
    where v_c is null or (e.received_at, e.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid)
    order by e.received_at desc, e.id desc
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'received_at', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

-- The Edge Function asks this (as the admin) before retrying with the service role.
create function public.meta_lead_retry_check(p_leadgen_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  return exists (select 1 from public.meta_lead_events where leadgen_id = p_leadgen_id and status in ('failed', 'received'));
end;
$$;

-- 02:30 IST: form answers are kept 14 days (PLAN.md D5 housekeeping).
select cron.schedule('meta-leads-housekeeping', '0 21 * * *',
  $$update public.meta_lead_events set payload = null where payload is not null and received_at < now() - interval '14 days'$$);

------------------------------------------------------------------------------
-- Stage automation from bookings and treatments
------------------------------------------------------------------------------
create function private.lead_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is null then
    return null;
  end if;
  if tg_op = 'INSERT' and new.status in ('pending_confirmation', 'confirmed') then
    perform private.lead_auto_stage(new.lead_id, 'consultation_booked',
                                    jsonb_build_object('appointment_id', new.id, 'slot_start', new.slot_start));
    perform private.lead_log(new.lead_id, 'appointment', null,
                             jsonb_build_object('appointment_id', new.id, 'slot_start', new.slot_start, 'status', new.status));
    update public.leads set last_activity_at = now() where id = new.lead_id;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('arrived', 'with_doctor', 'done') then
    perform private.lead_auto_stage(new.lead_id, 'consulted', jsonb_build_object('appointment_id', new.id));
  end if;
  return null;
end;
$$;
create trigger appointments_lead_stage after insert or update of status on public.appointments
  for each row execute function private.lead_from_appointment();

-- A treatment for a lead's patient: linked to the lead, agreed price taken from "Amount finalised".
create function private.treatment_from_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
begin
  if new.lead_id is null then
    select l.* into v_lead from public.leads l
    where l.patient_id = new.patient_id and l.deleted_at is null and l.stage not in ('converted', 'junk')
    order by l.created_at desc limit 1;
  else
    select l.* into v_lead from public.leads l where l.id = new.lead_id;
  end if;
  if v_lead.id is not null then
    new.lead_id := v_lead.id;
    if new.agreed_price_paise is null and v_lead.amount_finalised_paise is not null then
      new.agreed_price_paise := v_lead.amount_finalised_paise;
      new.agreed_by := v_lead.amount_finalised_by;
      new.agreed_at := v_lead.amount_finalised_at;
    end if;
  end if;
  return new;
end;
$$;
create trigger patient_treatments_lead before insert on public.patient_treatments
  for each row execute function private.treatment_from_lead();

create function private.lead_converted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null and new.status <> 'cancelled' then
    perform private.lead_auto_stage(new.lead_id, 'converted', jsonb_build_object('treatment_id', new.id, 'name', new.name));
  end if;
  return null;
end;
$$;
create trigger patient_treatments_converted after insert on public.patient_treatments
  for each row execute function private.lead_converted();

------------------------------------------------------------------------------
-- Appointments: sales book and confirm only their leads (Phase 3 left these checks here).
------------------------------------------------------------------------------
-- Cards show the lead's name and number when the booking has no patient yet.
create or replace function private.appt_card(a public.appointments, p public.patients)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'status', a.status, 'type', a.type, 'mode', a.mode, 'slot_start', a.slot_start, 'slot_end', a.slot_end,
    'doctor_id', a.doctor_id, 'is_walk_in', a.is_walk_in, 'queue_no', a.queue_no, 'version', a.version,
    'patient_id', a.patient_id, 'lead_id', a.lead_id, 'patient', coalesce(p.full_name, l.name), 'uhid', p.uhid,
    'phone', coalesce(p.whatsapp_e164, p.phone_e164, l.phone_e164), 'arrived_at', a.arrived_at, 'notes', a.notes,
    'lead_only', a.patient_id is null and a.lead_id is not null, 'lead_sl_no', l.sl_no)
  from (select 1) one
  left join public.leads l on l.id = a.lead_id;
$$;

create function private.can_book_lead(p_lead_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.leads l
    where l.id = p_lead_id and l.deleted_at is null
      and (private.has_role('receptionist', 'sales_manager', 'admin') or l.assigned_to = private.my_staff_id())) then
    perform private.fail('not_allowed', 'lead');
  end if;
end;
$$;

create or replace function public.book_appointment(p_booking jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_doctor uuid := (p_booking ->> 'doctor_id')::uuid;
  v_start timestamptz := (p_booking ->> 'slot_start')::timestamptz;
  v_patient uuid := (p_booking ->> 'patient_id')::uuid;
  v_lead uuid := (p_booking ->> 'lead_id')::uuid;
  v_slot record;
  v_row public.appointments;
  v_confirm boolean := coalesce((p_booking ->> 'confirm')::boolean, false);
  v_sales boolean := private.has_role('sales_executive', 'sales_manager');
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  select * into v_row from public.appointments where id = p_client_id;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;
  if v_doctor is null or v_start is null then
    perform private.fail('invalid_input', 'doctor and slot');
  end if;
  if v_patient is null and v_lead is null then
    perform private.fail('invalid_input', 'patient or lead');
  end if;
  -- Reception books patients; sales book their leads.
  if v_patient is not null and not private.has_role('receptionist', 'admin') then
    perform private.fail('not_allowed');
  end if;
  if v_patient is not null and not exists (select 1 from public.patients where id = v_patient and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
  end if;
  if v_lead is not null then
    perform private.can_book_lead(v_lead);
    -- A lead already registered: the booking is the patient's too.
    v_patient := coalesce(v_patient, (select l.patient_id from public.leads l where l.id = v_lead));
  elsif v_patient is not null then
    -- A patient who came from an open lead: the booking counts for that lead.
    select l.id into v_lead from public.leads l
    where l.patient_id = v_patient and l.deleted_at is null and l.stage not in ('converted', 'junk')
    order by l.created_at desc limit 1;
  end if;

  perform private.lock_slot(v_doctor, v_start);
  select * into v_slot from private.check_slot(v_doctor, v_start);

  insert into public.appointments (
    id, patient_id, lead_id, doctor_id, appt_date, slot_start, slot_end, type, mode, status,
    confirmed_via, confirmed_at, confirmed_by, source_id, booked_by, booked_from, notes, treatment_id, session_id)
  values (
    p_client_id, v_patient, v_lead, v_doctor, (private.ist(v_start))::date, v_slot.slot_start, v_slot.slot_end,
    coalesce((p_booking ->> 'type')::public.appt_type, 'consultation'),
    coalesce((p_booking ->> 'mode')::public.appt_mode, 'offline'),
    (case when v_confirm then 'confirmed' else 'pending_confirmation' end)::public.appt_status,
    case when v_confirm then (case when v_sales then 'sales_call' else 'reception' end)::public.confirm_via end,
    case when v_confirm then now() end, case when v_confirm then v_staff end,
    coalesce((p_booking ->> 'source_id')::uuid, (select l.source_id from public.leads l where l.id = v_lead)), v_staff,
    coalesce(nullif(p_booking ->> 'booked_from', ''), 'web'),
    nullif(btrim(p_booking ->> 'notes'), ''),
    (p_booking ->> 'treatment_id')::uuid, (p_booking ->> 'session_id')::uuid)
  returning * into v_row;
  return to_jsonb(v_row) || jsonb_build_object('repeat', false);
exception
  when invalid_text_representation then
    perform private.fail('invalid_input');
end;
$$;

create or replace function public.set_appointment_status(p_id uuid, p_status public.appt_status, p_reason text default null, p_version integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_row public.appointments;
begin
  select * into v_row from public.appointments where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if p_version is not null and v_row.version <> p_version then
    perform private.fail('stale_version');
  end if;
  -- Sales may only confirm or cancel bookings of leads they may book for.
  if not private.has_role('receptionist', 'admin') then
    if p_status not in ('confirmed', 'cancelled') or v_row.lead_id is null then
      perform private.fail('not_allowed');
    end if;
    perform private.can_book_lead(v_row.lead_id);
  end if;
  if not private.appt_transition_ok(v_row.status, p_status) then
    perform private.fail('invalid_status_change', format('%s → %s', v_row.status, p_status));
  end if;
  if p_status = 'cancelled' and length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('invalid_input', 'reason');
  end if;
  if p_status = 'no_show' and v_row.slot_start > now() then
    perform private.fail('invalid_status_change', 'not yet');
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);

  update public.appointments set
    status = p_status,
    confirmed_via = case when p_status = 'confirmed' then coalesce(confirmed_via,
      case when private.has_role('sales_executive', 'sales_manager') then 'sales_call' else 'reception' end::public.confirm_via) else confirmed_via end,
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    confirmed_by = case when p_status = 'confirmed' then v_staff else confirmed_by end,
    arrived_at = case when p_status = 'arrived' then coalesce(arrived_at, now()) else arrived_at end,
    with_doctor_at = case when p_status = 'with_doctor' then now() else with_doctor_at end,
    done_at = case when p_status = 'done' then now() else done_at end,
    cancel_reason = case when p_status = 'cancelled' then btrim(p_reason) else cancel_reason end,
    version = version + 1
  where id = p_id
  returning * into v_row;

  if p_status = 'arrived' and v_row.patient_id is not null then
    insert into public.visits (patient_id, appointment_id, doctor_id, visit_date)
    values (v_row.patient_id, v_row.id, v_row.doctor_id, (private.ist(now()))::date)
    on conflict (appointment_id) do nothing;
  elsif p_status = 'done' then
    update public.visits set check_out_at = now() where appointment_id = v_row.id and check_out_at is null;
  end if;
  -- A confirmation closes the "call to confirm" task.
  if p_status in ('confirmed', 'cancelled', 'arrived') then
    update public.followups set status = (case when p_status = 'cancelled' then 'cancelled' else 'done' end)::public.followup_status,
           done_at = now(), done_by = v_staff, outcome = p_status::text
     where kind = 'call_to_confirm' and ref_table = 'appointments' and ref_id = v_row.id and status = 'open';
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.reschedule_appointment(p_id uuid, p_new_start timestamptz, p_doctor_id uuid default null,
                                                         p_reason text default null, p_client_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_old public.appointments;
  v_doctor uuid;
  v_slot record;
  v_new public.appointments;
begin
  select * into v_old from public.appointments where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  -- Sales move only bookings of leads they may book for.
  if not private.has_role('receptionist', 'admin') then
    if v_old.lead_id is null then
      perform private.fail('not_allowed');
    end if;
    perform private.can_book_lead(v_old.lead_id);
  end if;
  if v_old.status not in ('pending_confirmation', 'confirmed', 'no_show') then
    perform private.fail('invalid_status_change', 'only upcoming bookings can be moved');
  end if;
  if p_client_id is not null and exists (select 1 from public.appointments where id = p_client_id) then
    return (select to_jsonb(a) from public.appointments a where a.id = p_client_id);
  end if;
  v_doctor := coalesce(p_doctor_id, v_old.doctor_id);
  perform private.lock_slot(v_doctor, p_new_start);
  select * into v_slot from private.check_slot(v_doctor, p_new_start);
  perform set_config('app.reason', coalesce(p_reason, ''), true);

  update public.appointments set status = 'rescheduled', version = version + 1 where id = p_id;
  insert into public.appointments (id, patient_id, lead_id, doctor_id, appt_date, slot_start, slot_end, type, mode, status,
                                   source_id, booked_by, booked_from, notes, treatment_id, session_id, rescheduled_from_id)
  values (coalesce(p_client_id, gen_random_uuid()), v_old.patient_id, v_old.lead_id, v_doctor,
          (private.ist(p_new_start))::date, v_slot.slot_start, v_slot.slot_end, v_old.type, v_old.mode,
          'pending_confirmation', v_old.source_id, v_staff, 'web', v_old.notes, v_old.treatment_id, v_old.session_id, v_old.id)
  returning * into v_new;
  update public.followups set status = 'cancelled', done_at = now(), done_by = v_staff, outcome = 'rescheduled'
   where ref_table = 'appointments' and ref_id = v_old.id and status = 'open';
  return to_jsonb(v_new);
end;
$$;

-- Waiting for a confirmation. Sales see their leads' bookings (executives: assigned leads).
create or replace function public.needs_confirmation(p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_exec boolean := private.has_role('sales_executive');
  v_manager boolean := private.has_role('sales_manager');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(x.card order by x.slot_start, x.id), '[]'::jsonb) into v_rows
  from (
    select private.appt_card(a, p) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name)) as card,
           a.slot_start, a.id
    from public.appointments a
    left join public.patients p on p.id = a.patient_id
    left join public.doctors d on d.id = a.doctor_id
    where a.status = 'pending_confirmation' and a.slot_start > now()
      and (not v_manager or a.lead_id is not null)
      and (not v_exec or a.lead_id in (select l.id from public.leads l where l.assigned_to = v_me and l.deleted_at is null))
      and (v_c is null or (a.slot_start, a.id) > ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by a.slot_start, a.id
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'slot_start', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

-- Today board: bookings of leads not yet registered show too (patient join → left join).
create or replace function public.today_board(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_date, (private.ist(now()))::date);
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return jsonb_build_object(
    'date', v_day,
    'counts', (
      select jsonb_build_object(
        'total', count(*) filter (where status not in ('cancelled', 'rescheduled')),
        'pending_confirmation', count(*) filter (where status = 'pending_confirmation'),
        'confirmed', count(*) filter (where status = 'confirmed'),
        'arrived', count(*) filter (where status = 'arrived'),
        'with_doctor', count(*) filter (where status = 'with_doctor'),
        'done', count(*) filter (where status = 'done'),
        'no_show', count(*) filter (where status = 'no_show'),
        'walk_ins', count(*) filter (where is_walk_in and status not in ('cancelled', 'rescheduled')))
      from public.appointments where appt_date = v_day),
    'waiting', coalesce((
      select jsonb_agg(private.appt_card(a, p) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name))
                       order by a.arrived_at)
      from public.appointments a
      left join public.patients p on p.id = a.patient_id
      left join public.doctors d on d.id = a.doctor_id
      where a.appt_date = v_day and a.status in ('arrived', 'with_doctor')), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(x.card order by x.slot_start)
      from (
        select private.appt_card(a, p) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name)) as card, a.slot_start
        from public.appointments a
        left join public.patients p on p.id = a.patient_id
        left join public.doctors d on d.id = a.doctor_id
        where a.appt_date = v_day and a.status in ('pending_confirmation', 'confirmed')
        order by a.slot_start
        limit 100) x), '[]'::jsonb),
    'followups_due', (select count(*) from public.followups f
                       where f.status = 'open' and f.due_date <= v_day and (f.assigned_to is null or f.patient_id is not null)),
    'pending_registrations', (select count(*) from public.registration_requests where status = 'pending'),
    'sessions_due_week', (select count(*) from public.treatment_sessions s
                           join public.patient_treatments t on t.id = s.treatment_id and t.status = 'active'
                          where s.status in ('planned', 'missed') and s.planned_date between v_day and v_day + 6));
end;
$$;

-- "Call to confirm" tasks for a lead's booking go to the lead's owner; the rest to reception.
create or replace function private.appointment_confirm_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer := (private.setting('appointments', 'confirm_hours_before', '4'))::int;
  v_n integer;
begin
  insert into public.followups (kind, patient_id, lead_id, due_date, due_at, reason, source, assigned_to, ref_table, ref_id)
  select 'call_to_confirm', a.patient_id, a.lead_id, a.appt_date, a.slot_start,
         'Call to confirm the appointment', 'system', l.assigned_to, 'appointments', a.id
  from public.appointments a
  left join public.leads l on l.id = a.lead_id and a.patient_id is null and l.deleted_at is null
  where a.status = 'pending_confirmation'
    and a.slot_start > now() and a.slot_start <= now() + make_interval(hours => v_hours)
  on conflict (kind, ref_table, ref_id) where ref_id is not null and status = 'open' do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Closing a lead's follow-up clears its due date.
create or replace function public.complete_followup(p_id uuid, p_outcome text default null, p_cancel boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff();
  v_row public.followups;
begin
  select * into v_row from public.followups where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if not (private.has_role('admin') or v_row.assigned_to = v_staff
          or (private.has_role('receptionist') and (v_row.assigned_to is null or v_row.patient_id is not null))
          or (private.has_role('sales_manager') and v_row.source = 'sales')) then
    perform private.fail('not_allowed');
  end if;
  update public.followups
     set status = case when p_cancel then 'cancelled'::public.followup_status else 'done' end,
         done_at = now(), done_by = v_staff, outcome = nullif(btrim(p_outcome), '')
   where id = p_id and status = 'open'
  returning * into v_row;
  if not found then
    perform private.fail('stale_version', 'already closed');
  end if;
  if v_row.ref_table = 'leads' then
    update public.leads set next_followup_at = null, last_activity_at = now()
     where id = v_row.ref_id and next_followup_at is not distinct from v_row.due_at;
  end if;
  return to_jsonb(v_row);
end;
$$;

------------------------------------------------------------------------------
-- Search and menu badges
------------------------------------------------------------------------------
-- Reception: patients and leads. Sales: leads only (executives: their own). Admin: both.
create or replace function public.global_search(p_q text, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
  v_me uuid;
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
  v_phone_only boolean := v_q ~ '^[0-9\s+()-]+$';
  v_has_letters boolean := v_q ~ '[[:alpha:]]';
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 20);
  v_patients jsonb := '[]'::jsonb;
  v_leads jsonb := '[]'::jsonb;
begin
  v_me := private.require_staff();
  v_role := private.my_role();
  if length(v_q) < 2 or v_role = 'bdm' then
    return '[]'::jsonb;
  end if;

  if v_role in ('receptionist', 'admin') then
    with hits as (
      select p.id, 0 as rank, 1.0::real as sim from public.patients p
       where lower(p.uhid) like lower(private.like_escape(v_q)) || '%' and p.merged_into_id is null
      union all
      select p.id, 1, 1.0 from public.patients p
       where v_phone_only and length(v_digits) >= 10 and p.merged_into_id is null
         and right(v_digits, 10) in (p.phone_last10, p.whatsapp_last10, p.alt_phone_last10)
      union all
      select p.id, 2, 1.0 from public.patients p
       where v_phone_only and length(v_digits) between 4 and 9
         and p.merged_into_id is null and p.phone_last10 like '%' || v_digits
      union all
      select p.id, 3, extensions.similarity(p.full_name, v_q) from public.patients p
       where v_has_letters and p.merged_into_id is null
         and p.full_name ilike '%' || private.like_escape(v_q) || '%'
    ), best as (
      select h.id, min(h.rank) as rank, max(h.sim) as sim from hits h group by h.id
      order by min(h.rank), max(h.sim) desc limit v_limit
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'type', 'patient', 'id', p.id, 'title', p.full_name, 'uhid', p.uhid, 'rank', b.rank,
             'subtitle', concat_ws(' · ', p.uhid, p.phone_e164,
               case when p.dob is not null then private.age_years(p.dob)::text || ' y' end))
           order by b.rank, b.sim desc, p.full_name), '[]'::jsonb)
      into v_patients
    from best b join public.patients p on p.id = b.id;
  end if;

  with hits as (
    select l.id, 1 as rank, 1.0::real as sim from public.leads l
     where v_phone_only and length(v_digits) >= 10 and l.deleted_at is null
       and right(v_digits, 10) in (l.phone_last10, l.alt_phone_last10)
    union all
    select l.id, 2, 1.0 from public.leads l
     where v_phone_only and length(v_digits) between 4 and 9 and l.deleted_at is null and l.phone_last10 like '%' || v_digits
    union all
    select l.id, 3, extensions.similarity(l.name, v_q) from public.leads l
     where v_has_letters and l.deleted_at is null and l.name ilike '%' || private.like_escape(v_q) || '%'
  ), best as (
    select h.id, min(h.rank) as rank, max(h.sim) as sim
    from hits h join public.leads l on l.id = h.id
    where v_role <> 'sales_executive' or l.assigned_to = v_me
    group by h.id
    order by min(h.rank), max(h.sim) desc limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', 'lead', 'id', l.id, 'title', l.name, 'stage', l.stage, 'rank', b.rank,
           'subtitle', concat_ws(' · ', '#' || l.sl_no, l.phone_e164, s.full_name))
         order by b.rank, b.sim desc, l.name), '[]'::jsonb)
    into v_leads
  from best b join public.leads l on l.id = b.id left join public.staff s on s.id = l.assigned_to;

  -- Patients first, then leads; best matches first within each, at most p_limit in all.
  return coalesce((
    select jsonb_agg(e.value order by e.ord)
    from (select x.value, row_number() over () as ord
          from jsonb_array_elements(v_patients || v_leads) x) e
    where e.ord <= v_limit), '[]'::jsonb);
end;
$$;

-- Menu counts: pharmacy alerts (reception/admin), leads waiting for an owner (managers/admin),
-- overdue lead follow-ups (executives).
create or replace function public.nav_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff();
  v_role public.staff_role := private.my_role();
  v_out jsonb := '{}'::jsonb;
begin
  if v_role in ('receptionist', 'admin') then
    v_out := v_out || jsonb_build_object('pharmacy', (select count(*) from public.stock_alerts where cleared_at is null));
  end if;
  if v_role in ('sales_manager', 'admin') then
    v_out := v_out || jsonb_build_object('leads', (select count(*) from public.leads
                                                   where deleted_at is null and assigned_to is null
                                                     and stage not in ('converted', 'lost', 'junk')));
  elsif v_role = 'sales_executive' then
    v_out := v_out || jsonb_build_object('leads', (select count(*) from public.leads
                                                   where assigned_to = v_me and deleted_at is null
                                                     and next_followup_at < now()));
  end if;
  return v_out;
end;
$$;

------------------------------------------------------------------------------
-- Phone sync (Android). One call returns, per entity, the rows changed after the marker the
-- phone sent, the ids it must drop, the next marker and has_more. Marker = "<updated_at>|<id>"
-- (keyset). Once caught up the marker moves to a minute ago, so a row saved by a slower
-- transaction is still picked up and old removals are not sent again.
------------------------------------------------------------------------------
create function private.sync_page(p_rows jsonb, p_limit integer, p_at timestamptz, p_id uuid, p_removed jsonb)
returns jsonb
language sql
stable
as $$
  with page as (
    select e.value, e.ordinality from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality e
    where e.ordinality <= p_limit
  ), last_row as (
    select (value ->> 'updated_at')::timestamptz as at, (value ->> 'id')::uuid as id from page order by ordinality desc limit 1
  ), more as (select jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > p_limit as has_more)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(value order by ordinality) from page), '[]'::jsonb),
    'removed', coalesce(p_removed, '[]'::jsonb),
    'has_more', (select has_more from more),
    'next', (
      select case
        when (select has_more from more) then m.at::text || '|' || m.id::text
        when m.at is null or m.at < now() - interval '1 minute' then
          greatest(coalesce(m.at, p_at), p_at, now() - interval '1 minute')::text || '|' ||
          case when greatest(coalesce(m.at, p_at), p_at) >= now() - interval '1 minute' then coalesce(m.id, p_id)::text
               else '00000000-0000-0000-0000-000000000000' end
        else m.at::text || '|' || m.id::text end
      from (select (select at from last_row) as at, (select id from last_row) as id) m));
$$;

create function public.sync_pull(p_since jsonb default '{}', p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]);
  v_role public.staff_role := private.my_role();
  v_all boolean := v_role in ('sales_manager', 'admin');
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_since jsonb := coalesce(p_since, '{}'::jsonb);
  v_entities text[] := case when v_role = 'bdm' then array['leads', 'lookup_values']
                            else array['leads', 'followups', 'appointments', 'call_logs', 'crm_numbers', 'lookup_values'] end;
  v_entity text;
  v_marker text;
  v_at timestamptz;
  v_id uuid;
  v_rows jsonb;
  v_removed jsonb;
  v_out jsonb := '{}'::jsonb;
  v_from_day date := (private.ist(now()))::date - 60;
begin
  if jsonb_typeof(v_since) <> 'object' then
    perform private.fail('invalid_input', 'since');
  end if;
  foreach v_entity in array v_entities loop
    continue when not v_since ? v_entity;
    v_marker := nullif(v_since ->> v_entity, '');
    begin
      v_at := coalesce(split_part(v_marker, '|', 1)::timestamptz, '-infinity');
      v_id := coalesce(nullif(split_part(v_marker, '|', 2), '')::uuid, '00000000-0000-0000-0000-000000000000');
    exception when others then
      perform private.fail('invalid_input', 'marker ' || v_entity);
    end;
    v_rows := null;
    v_removed := '[]'::jsonb;

    if v_entity in ('leads', 'crm_numbers') then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select case
                 when v_entity = 'crm_numbers' then jsonb_build_object('id', l.id, 'lead_id', l.id, 'phone_last10', l.phone_last10,
                   'alt_phone_last10', l.alt_phone_last10, 'patient_id', l.patient_id, 'updated_at', l.updated_at)
                 when v_role = 'bdm' then jsonb_build_object('id', l.id, 'sl_no', l.sl_no, 'name', l.name,
                   'phone_e164', l.phone_e164, 'stage', l.stage, 'lead_date', l.lead_date, 'created_at', l.created_at,
                   'updated_at', l.updated_at)
                 else to_jsonb(l) end as j,
               l.updated_at, l.id
        from public.leads l
        where l.deleted_at is null
          and (v_all or (v_role = 'bdm' and l.created_by = v_me) or (v_role = 'sales_executive' and l.assigned_to = v_me))
          and (l.updated_at, l.id) > (v_at, v_id)
        order by l.updated_at, l.id
        limit v_limit + 1) x;
      if v_at > '-infinity' then
        select coalesce(jsonb_agg(distinct r.id), '[]'::jsonb) into v_removed
        from (
          select a.lead_id as id from public.lead_assignments a join public.leads l on l.id = a.lead_id
          where v_role = 'sales_executive' and a.from_staff = v_me and a.at > v_at and l.assigned_to is distinct from v_me
          union all
          select l.id from public.leads l
          where l.deleted_at > v_at
            and (v_all or (v_role = 'bdm' and l.created_by = v_me) or (v_role = 'sales_executive' and l.assigned_to = v_me))
          limit 1000) r;
      end if;

    elsif v_entity = 'followups' then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select to_jsonb(f) as j, f.updated_at, f.id from public.followups f
        where f.assigned_to = v_me and (f.updated_at, f.id) > (v_at, v_id)
        union all
        select to_jsonb(f), f.updated_at, f.id from public.followups f
        where v_all and f.source = 'sales' and f.assigned_to is distinct from v_me and (f.updated_at, f.id) > (v_at, v_id)
        order by 2, 3
        limit v_limit + 1) x;

    elsif v_entity = 'appointments' then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select to_jsonb(a) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name)) as j, a.updated_at, a.id
        from public.appointments a left join public.doctors d on d.id = a.doctor_id
        where a.appt_date >= v_from_day and (a.updated_at, a.id) > (v_at, v_id)
          and ((v_all and a.lead_id is not null)
               or a.booked_by = v_me
               or a.lead_id in (select l.id from public.leads l where l.assigned_to = v_me and l.deleted_at is null))
        order by a.updated_at, a.id
        limit v_limit + 1) x;

    elsif v_entity = 'call_logs' then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select to_jsonb(c) as j, c.updated_at, c.id from public.call_logs c
        where (v_all or c.staff_id = v_me) and c.started_at >= now() - interval '60 days'
          and (c.updated_at, c.id) > (v_at, v_id)
        order by c.updated_at, c.id
        limit v_limit + 1) x;

    elsif v_entity = 'lookup_values' then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select jsonb_build_object('id', v.id, 'kind', v.kind, 'label', v.label, 'code', v.code, 'sort', v.sort,
                                  'active', v.active and v.merged_into_id is null, 'usage_count', v.usage_count,
                                  'updated_at', v.updated_at) as j, v.updated_at, v.id
        from public.lookup_values v
        where v.kind in ('lead_source', 'lost_reason', 'referral_name', 'quick_reply', 'break_type')
          and (v.updated_at, v.id) > (v_at, v_id)
        order by v.updated_at, v.id
        limit v_limit + 1) x;
    end if;

    v_out := v_out || jsonb_build_object(v_entity, private.sync_page(v_rows, v_limit, v_at, v_id, v_removed));
  end loop;
  return jsonb_build_object('server_time', now(), 'entities', v_out);
end;
$$;

------------------------------------------------------------------------------
-- Sales dashboards (PLAN.md B6). Each is one call; every series is one grouped query joined
-- onto its day/bucket series. Ranges are capped at one year.
------------------------------------------------------------------------------
create function private.check_range(p_from date, p_to date)
returns void
language plpgsql
immutable
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
end;
$$;

-- Funnel of the leads that came in during the range: how many reached each rung (by the
-- highest rung ever reached, so a lead lost after consulting still counts as consulted).
create function private.lead_funnel(p_from date, p_to date, p_staff uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select l.max_stage_rank, l.stage from public.leads l
    where l.deleted_at is null and l.lead_date between p_from and p_to
      and (p_staff is null or l.assigned_to = any (p_staff))
  ), rungs (stage, rank) as (
    values ('new', 0), ('contacted', 1), ('interested', 2), ('consultation_booked', 3), ('consulted', 4),
           ('surgery_scheduled', 5), ('converted', 6)
  )
  select jsonb_build_object(
    'steps', (select jsonb_agg(jsonb_build_object('stage', r.stage, 'n', (select count(*) from c where c.max_stage_rank >= r.rank))
                               order by r.rank) from rungs r),
    'lost', (select count(*) from c where c.stage = 'lost'),
    'junk', (select count(*) from c where c.stage = 'junk'));
$$;

create function private.sales_tiles(p_from date, p_to date, p_staff uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select private.ist_at(p_from, '00:00') as lo, private.ist_at(p_to + 1, '00:00') as hi),
  cohort as (
    select l.* from public.leads l
    where l.deleted_at is null and l.lead_date between p_from and p_to and (p_staff is null or l.assigned_to = any (p_staff))
  ), appts as (
    select a.created_at, a.slot_start, a.arrived_at, a.status
    from public.appointments a join public.leads l on l.id = a.lead_id, b
    where a.lead_id is not null and (p_staff is null or l.assigned_to = any (p_staff))
      and ((a.created_at >= b.lo and a.created_at < b.hi) or (a.slot_start >= b.lo and a.slot_start < b.hi))
      and a.rescheduled_from_id is null
  )
  select jsonb_build_object(
    'new_leads', (select count(*) from cohort),
    'contacted_1h', (select count(*) from cohort where created_via <> 'import' and first_call_at <= created_at + interval '1 hour'),
    'contact_base', (select count(*) from cohort where created_via <> 'import'),
    'consultations_booked', (select count(*) from appts, b where appts.created_at >= b.lo and appts.created_at < b.hi),
    'shows', (select count(*) from appts, b where appts.slot_start >= b.lo and appts.slot_start < b.hi and appts.slot_start < now()
                and appts.arrived_at is not null),
    'show_base', (select count(*) from appts, b where appts.slot_start >= b.lo and appts.slot_start < b.hi and appts.slot_start < now()
                    and appts.status not in ('cancelled', 'rescheduled')),
    'converted', (select count(*) from public.leads l, b where l.converted_at >= b.lo and l.converted_at < b.hi and l.deleted_at is null
                    and (p_staff is null or l.assigned_to = any (p_staff))),
    'cohort_converted', (select count(*) from cohort where stage = 'converted'),
    'agreed_paise', (select coalesce(sum(l.amount_finalised_paise), 0) from public.leads l, b
                     where l.amount_finalised_at >= b.lo and l.amount_finalised_at < b.hi and l.deleted_at is null
                       and (p_staff is null or l.assigned_to = any (p_staff))));
$$;

create function public.dashboard_sales_manager(p_from date, p_to date, p_staff_ids uuid[] default null, p_compare boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_bucket text;
  v_lo timestamptz;
  v_hi timestamptz;
  v_staff uuid[] := case when cardinality(p_staff_ids) > 0 then p_staff_ids end;
  v_today date := (private.ist(now()))::date;
begin
  perform private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  perform private.check_range(p_from, p_to);
  v_days := p_to - p_from + 1;
  v_bucket := case when v_days <= 31 then 'day' when v_days <= 120 then 'week' else 'month' end;
  v_lo := private.ist_at(p_from, '00:00');
  v_hi := private.ist_at(p_to + 1, '00:00');
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'bucket', v_bucket,
    'tiles', private.sales_tiles(p_from, p_to, v_staff)
      || jsonb_build_object('overdue_followups', (
           select count(*) from public.followups f
           where f.status = 'open' and f.source = 'sales' and f.due_date < v_today
             and (v_staff is null or f.assigned_to = any (v_staff)))),
    'previous', case when p_compare then private.sales_tiles(p_from - v_days, p_from - 1, v_staff) end,
    'funnel', private.lead_funnel(p_from, p_to, v_staff),
    -- Leads by source over time: top 6 sources, the rest folded into "Other".
    'by_source', (
      with cohort as (
        select l.source_id, date_trunc(v_bucket, l.lead_date::timestamp)::date as bucket
        from public.leads l
        where l.deleted_at is null and l.lead_date between p_from and p_to and (v_staff is null or l.assigned_to = any (v_staff))
      ), top as (
        select c.source_id, row_number() over (order by count(*) desc, c.source_id) as rn
        from cohort c group by c.source_id
      ), folded as (
        select case when t.rn <= 6 then c.source_id::text else 'other' end as key, c.bucket
        from cohort c join top t on t.source_id is not distinct from c.source_id
      ), counts as (
        select key, bucket, count(*) as n from folded group by key, bucket
      ), buckets as (
        select g::date as bucket from generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp,
                                                      ('1 ' || v_bucket)::interval) g
      ), keys as (
        select distinct key from folded
      )
      select jsonb_build_object(
        'buckets', (select coalesce(jsonb_agg(bucket order by bucket), '[]'::jsonb) from buckets),
        'series', coalesce((
          select jsonb_agg(jsonb_build_object('id', s.key, 'label', s.label, 'data', s.data) order by s.total desc)
          from (
            select k.key, coalesce(lv.label, case when k.key = 'other' then null end) as label,
                   jsonb_agg(coalesce(c.n, 0) order by b.bucket) as data, sum(coalesce(c.n, 0)) as total
            from keys k cross join buckets b
            left join counts c on c.key is not distinct from k.key and c.bucket = b.bucket
            left join public.lookup_values lv on k.key <> 'other' and lv.id::text = k.key
            group by k.key, lv.label
          ) s), '[]'::jsonb))),
    'conversion_by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source_id', x.source_id, 'label', lv.label, 'leads', x.leads, 'converted', x.converted)
                       order by x.leads desc)
      from (
        select l.source_id, count(*) as leads, count(*) filter (where l.stage = 'converted') as converted
        from public.leads l
        where l.deleted_at is null and l.lead_date between p_from and p_to and (v_staff is null or l.assigned_to = any (v_staff))
        group by l.source_id
      ) x left join public.lookup_values lv on lv.id = x.source_id), '[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object(
               'staff_id', s.id, 'name', s.full_name, 'active', s.active,
               'leads', coalesce(ld.n, 0), 'calls', coalesce(cl.n, 0), 'connected', coalesce(cl.connected, 0),
               'talk_s', coalesce(cl.talk_s, 0), 'converted', coalesce(cv.n, 0), 'agreed_paise', coalesce(ag.paise, 0))
             order by coalesce(cv.n, 0) desc, coalesce(ag.paise, 0) desc, s.full_name)
      from public.staff s
      left join (select l.assigned_to, count(*) as n from public.leads l
                 where l.deleted_at is null and l.lead_date between p_from and p_to group by l.assigned_to) ld on ld.assigned_to = s.id
      left join (select c.staff_id, count(*) as n, count(*) filter (where c.outcome = 'connected') as connected,
                        sum(c.duration_s) as talk_s
                 from public.call_logs c where c.started_at >= v_lo and c.started_at < v_hi group by c.staff_id) cl on cl.staff_id = s.id
      left join (select l.assigned_to, count(*) as n from public.leads l
                 where l.converted_at >= v_lo and l.converted_at < v_hi and l.deleted_at is null group by l.assigned_to) cv on cv.assigned_to = s.id
      left join (select l.assigned_to, sum(l.amount_finalised_paise) as paise from public.leads l
                 where l.amount_finalised_at >= v_lo and l.amount_finalised_at < v_hi and l.deleted_at is null
                 group by l.assigned_to) ag on ag.assigned_to = s.id
      where s.role in ('sales_executive', 'sales_manager') and (v_staff is null or s.id = any (v_staff))
        and (s.active or ld.n is not null or cl.n is not null)), '[]'::jsonb),
    'heatmap', coalesce((
      select jsonb_agg(jsonb_build_object('dow', x.dow, 'hour', x.hour, 'n', x.n) order by x.dow, x.hour)
      from (
        select extract(isodow from private.ist(c.started_at))::int as dow, extract(hour from private.ist(c.started_at))::int as hour,
               count(*) as n
        from public.call_logs c
        where c.started_at >= v_lo and c.started_at < v_hi and (v_staff is null or c.staff_id = any (v_staff))
        group by 1, 2
      ) x), '[]'::jsonb),
    'lost_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.lost_reason_id, 'label', lv.label, 'n', x.n) order by x.n desc)
      from (
        select l.lost_reason_id, count(*) as n from public.leads l
        where l.deleted_at is null and l.stage = 'lost' and l.lead_date between p_from and p_to
          and (v_staff is null or l.assigned_to = any (v_staff))
        group by l.lost_reason_id
      ) x left join public.lookup_values lv on lv.id = x.lost_reason_id), '[]'::jsonb),
    -- Agreed (Amount finalised) vs billed (finalized bills of the lead's patient since the lead
    -- came in), for leads converted in the range; one lead per patient.
    'agreed_vs_billed', coalesce((
      with conv as (
        select distinct on (l.patient_id) l.patient_id, l.assigned_to, l.amount_finalised_paise, l.created_at
        from public.leads l
        where l.converted_at >= v_lo and l.converted_at < v_hi and l.deleted_at is null and l.patient_id is not null
          and (v_staff is null or l.assigned_to = any (v_staff))
        order by l.patient_id, l.converted_at desc
      ), billed as (
        select c.patient_id, sum(b.total_paise) as paise
        from conv c join public.bills b on b.patient_id = c.patient_id and b.status = 'finalized' and b.bill_at >= c.created_at
        group by c.patient_id
      )
      select jsonb_agg(jsonb_build_object('staff_id', x.assigned_to, 'name', s.full_name, 'agreed_paise', x.agreed,
                                          'billed_paise', x.billed, 'patients', x.n) order by x.agreed desc)
      from (
        select c.assigned_to, sum(coalesce(c.amount_finalised_paise, 0)) as agreed, sum(coalesce(bl.paise, 0)) as billed, count(*) as n
        from conv c left join billed bl on bl.patient_id = c.patient_id
        group by c.assigned_to
      ) x left join public.staff s on s.id = x.assigned_to), '[]'::jsonb));
end;
$$;

-- Sales executive "My day" (Android; managers see their own too).
create function public.dashboard_sales_exec(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager']::public.staff_role[]);
  v_today date := (private.ist(now()))::date;
  v_from date := coalesce(p_from, date_trunc('month', v_today::timestamp)::date);
  v_to date := coalesce(p_to, v_today);
  v_lo timestamptz := private.ist_at(v_today, '00:00');
  v_hi timestamptz := private.ist_at(v_today + 1, '00:00');
begin
  perform private.check_range(v_from, v_to);
  return jsonb_build_object(
    'date', v_today, 'from', v_from, 'to', v_to,
    'today', (
      select jsonb_build_object(
        'calls', count(*), 'connected', count(*) filter (where c.outcome = 'connected'),
        'talk_s', coalesce(sum(c.duration_s), 0))
      from public.call_logs c where c.staff_id = v_me and c.started_at >= v_lo and c.started_at < v_hi)
      || jsonb_build_object(
        'followups_due', (select count(*) from public.followups f where f.assigned_to = v_me and f.status = 'open' and f.due_date = v_today),
        'followups_overdue', (select count(*) from public.followups f where f.assigned_to = v_me and f.status = 'open' and f.due_date < v_today),
        'booked', (select count(*) from public.appointments a
                   where a.booked_by = v_me and a.created_at >= v_lo and a.created_at < v_hi and a.rescheduled_from_id is null),
        'pending_confirmations', (select count(*) from public.appointments a
                                  where a.status = 'pending_confirmation' and a.slot_start > now()
                                    and a.lead_id in (select l.id from public.leads l where l.assigned_to = v_me and l.deleted_at is null))),
    'month', private.sales_tiles(v_from, v_to, array[v_me]),
    'target', null,
    'calls_per_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'calls', coalesce(x.calls, 0), 'connected', coalesce(x.connected, 0))
                       order by d.day)
      from (select (v_today - g)::date as day from generate_series(0, 13) g) d
      left join (
        select (private.ist(c.started_at))::date as day, count(*) as calls, count(*) filter (where c.outcome = 'connected') as connected
        from public.call_logs c
        where c.staff_id = v_me and c.started_at >= private.ist_at(v_today - 13, '00:00') and c.started_at < v_hi
        group by 1
      ) x on x.day = d.day), '[]'::jsonb),
    'funnel', private.lead_funnel(v_from, v_to, array[v_me]));
end;
$$;

alter default privileges revoke execute on functions from public;
select private.lock_down_public_functions();
