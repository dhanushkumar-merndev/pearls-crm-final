-- Pearl CRM — Phase 4: treatments and sessions (PLAN.md C3 "Care", D2 "Treatments, sessions, follow-ups")
-- Start a treatment from a template (editable defaults), sessions planned from day gaps,
-- re-planning that only touches future planned sessions, audited price changes,
-- session ↔ appointment sync, "book next session?" suggestions, end-of-plan follow-up.

create type public.treatment_status as enum ('active', 'on_hold', 'completed', 'closed', 'cancelled');
create type public.session_status as enum ('planned', 'booked', 'done', 'missed', 'skipped');

create table public.patient_treatments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  template_id uuid references public.treatment_templates (id),
  name text not null check (length(btrim(name)) between 1 and 200),
  category public.treatment_category not null default 'procedure',
  status public.treatment_status not null default 'active',
  doctor_id uuid references public.doctors (id),
  start_date date not null,
  planned_sessions smallint not null check (planned_sessions between 1 and 100),
  gap_days integer[] not null default '{0}' check (cardinality(gap_days) >= 1 and 0 <= all (gap_days)),
  pricing text not null default 'package' check (pricing in ('per_session', 'package')),
  package_price_paise bigint not null default 0 check (package_price_paise >= 0),
  agreed_price_paise bigint check (agreed_price_paise >= 0),
  agreed_by uuid references public.staff (id),
  agreed_at timestamptz,
  lead_id uuid,                -- FK added in Phase 9
  drip_campaign_id uuid,       -- FK added in Phase 10
  discharge_template_id uuid,  -- FK added in Phase 7
  follow_up_days smallint check (follow_up_days between 0 and 3650),
  notes text check (length(notes) <= 4000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index patient_treatments_patient on public.patient_treatments (patient_id, status);
create index patient_treatments_template on public.patient_treatments (template_id) where template_id is not null;
create trigger patient_treatments_touch before update on public.patient_treatments
  for each row execute function private.touch_updated();
create trigger patient_treatments_audit after insert or update or delete on public.patient_treatments
  for each row execute function private.audit_row();

create table public.treatment_sessions (
  id uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.patient_treatments (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  seq smallint not null check (seq >= 1),
  planned_date date not null,
  actual_date date,
  status public.session_status not null default 'planned',
  doctor_id uuid references public.doctors (id),
  appointment_id uuid references public.appointments (id),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (treatment_id, seq)
);
create index treatment_sessions_due on public.treatment_sessions (status, planned_date);
create index treatment_sessions_patient on public.treatment_sessions (patient_id);
create index treatment_sessions_appointment on public.treatment_sessions (appointment_id) where appointment_id is not null;
create trigger treatment_sessions_touch before update on public.treatment_sessions
  for each row execute function private.touch_updated();
create trigger treatment_sessions_audit after insert or update or delete on public.treatment_sessions
  for each row execute function private.audit_row();

alter table public.appointments
  add constraint appointments_treatment_fk foreign key (treatment_id) references public.patient_treatments (id),
  add constraint appointments_session_fk foreign key (session_id) references public.treatment_sessions (id);
alter table public.documents
  add constraint documents_session_fk foreign key (session_id) references public.treatment_sessions (id);

alter table public.patient_treatments enable row level security;
alter table public.treatment_sessions enable row level security;
grant select on public.patient_treatments, public.treatment_sessions to authenticated;
create policy patient_treatments_select on public.patient_treatments for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy treatment_sessions_select on public.treatment_sessions for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));

------------------------------------------------------------------------------
-- Planning: session n's date = start + gap_days[n]. Past the last gap, keep the
-- last interval (e.g. {0,30} → 0, 30, 60, 90 …).
------------------------------------------------------------------------------
create function private.session_offset(p_gaps integer[], p_seq integer)
returns integer
language sql
immutable
as $$
  select case
    when p_seq <= cardinality(p_gaps) then p_gaps[p_seq]
    when cardinality(p_gaps) = 1 then p_gaps[1] * p_seq
    else p_gaps[cardinality(p_gaps)]
         + (p_seq - cardinality(p_gaps)) * (p_gaps[cardinality(p_gaps)] - p_gaps[cardinality(p_gaps) - 1])
  end;
$$;

create function private.treatment_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(t) || jsonb_build_object(
    'doctor', coalesce(d.display_name, d.full_name),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'seq', s.seq, 'planned_date', s.planned_date, 'actual_date', s.actual_date,
               'status', s.status, 'appointment_id', s.appointment_id, 'slot_start', a.slot_start, 'notes', s.notes)
             order by s.seq)
      from public.treatment_sessions s left join public.appointments a on a.id = s.appointment_id
      where s.treatment_id = t.id), '[]'::jsonb),
    'done_count', (select count(*) from public.treatment_sessions s where s.treatment_id = t.id and s.status = 'done'))
  from public.patient_treatments t left join public.doctors d on d.id = t.doctor_id
  where t.id = p_id;
$$;

-- Start a treatment. Template defaults can all be changed by the receptionist.
create function public.start_treatment(p_treatment jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_template public.treatment_templates;
  v_patient uuid := (p_treatment ->> 'patient_id')::uuid;
  v_sessions integer;
  v_gaps integer[];
  v_start date := coalesce((p_treatment ->> 'start_date')::date, (private.ist(now()))::date);
  v_agreed bigint := (p_treatment ->> 'agreed_price_paise')::bigint;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  if exists (select 1 from public.patient_treatments where id = p_client_id) then
    return private.treatment_card(p_client_id);
  end if;
  if not exists (select 1 from public.patients where id = v_patient and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
  end if;
  select * into v_template from public.treatment_templates where id = (p_treatment ->> 'template_id')::uuid;

  v_sessions := coalesce((p_treatment ->> 'sessions')::int, v_template.default_sessions, 1);
  v_gaps := coalesce(
    case when p_treatment ? 'gap_days' then array(select jsonb_array_elements_text(p_treatment -> 'gap_days'))::int[] end,
    v_template.gap_days, '{0}');
  if v_sessions < 1 or v_sessions > 100 then
    perform private.fail('invalid_input', 'sessions');
  end if;

  insert into public.patient_treatments (
    id, patient_id, template_id, name, category, doctor_id, start_date, planned_sessions, gap_days, pricing,
    package_price_paise, agreed_price_paise, agreed_by, agreed_at, lead_id, follow_up_days, notes, discharge_template_id)
  values (
    p_client_id, v_patient, v_template.id,
    coalesce(nullif(btrim(p_treatment ->> 'name'), ''), v_template.name),
    coalesce((p_treatment ->> 'category')::public.treatment_category, v_template.category, 'procedure'),
    (p_treatment ->> 'doctor_id')::uuid, v_start, v_sessions, v_gaps,
    coalesce(p_treatment ->> 'pricing', v_template.pricing, 'package'),
    coalesce((p_treatment ->> 'price_paise')::bigint, v_template.default_price_paise, 0),
    v_agreed, case when v_agreed is not null then v_staff end, case when v_agreed is not null then now() end,
    (p_treatment ->> 'lead_id')::uuid,
    coalesce((p_treatment ->> 'follow_up_days')::smallint, v_template.follow_up_days),
    nullif(btrim(p_treatment ->> 'notes'), ''), v_template.discharge_template_id);

  insert into public.treatment_sessions (treatment_id, patient_id, seq, planned_date, doctor_id)
  select p_client_id, v_patient, n, v_start + private.session_offset(v_gaps, n), (p_treatment ->> 'doctor_id')::uuid
  from generate_series(1, v_sessions) n;

  perform private.library_used('treatment_templates', v_template.id);
  return private.treatment_card(p_client_id);
exception
  when invalid_text_representation or check_violation then
    perform private.fail('invalid_input');
end;
$$;

-- Edit a treatment. Changing the gaps re-plans ONLY future sessions still 'planned'
-- (never booked, done, missed or past ones). A price change needs a reason (audited).
create function public.update_treatment(p_id uuid, p_patch jsonb, p_version integer, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_row public.patient_treatments;
  v_gaps integer[];
  v_today date := (private.ist(now()))::date;
  v_price_changes boolean;
begin
  select * into v_row from public.patient_treatments where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_row.version <> p_version then
    perform private.fail('stale_version');
  end if;
  v_price_changes := (p_patch ? 'price_paise' and (p_patch ->> 'price_paise')::bigint is distinct from v_row.package_price_paise)
                  or (p_patch ? 'agreed_price_paise' and (p_patch ->> 'agreed_price_paise')::bigint is distinct from v_row.agreed_price_paise);
  if v_price_changes and length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required', 'price change');
  end if;
  if p_patch ? 'status' and (p_patch ->> 'status') in ('closed', 'cancelled') and length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required', 'closing a treatment');
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  v_gaps := case when p_patch ? 'gap_days' then array(select jsonb_array_elements_text(p_patch -> 'gap_days'))::int[] end;

  update public.patient_treatments t set
    name = coalesce(nullif(btrim(p_patch ->> 'name'), ''), t.name),
    doctor_id = case when p_patch ? 'doctor_id' then (p_patch ->> 'doctor_id')::uuid else t.doctor_id end,
    status = coalesce((p_patch ->> 'status')::public.treatment_status, t.status),
    gap_days = coalesce(v_gaps, t.gap_days),
    pricing = coalesce(p_patch ->> 'pricing', t.pricing),
    package_price_paise = coalesce((p_patch ->> 'price_paise')::bigint, t.package_price_paise),
    agreed_price_paise = case when p_patch ? 'agreed_price_paise' then (p_patch ->> 'agreed_price_paise')::bigint else t.agreed_price_paise end,
    agreed_by = case when p_patch ? 'agreed_price_paise' then v_staff else t.agreed_by end,
    agreed_at = case when p_patch ? 'agreed_price_paise' then now() else t.agreed_at end,
    follow_up_days = case when p_patch ? 'follow_up_days' then (p_patch ->> 'follow_up_days')::smallint else t.follow_up_days end,
    notes = case when p_patch ? 'notes' then nullif(btrim(p_patch ->> 'notes'), '') else t.notes end,
    version = t.version + 1
  where t.id = p_id
  returning * into v_row;

  if v_gaps is not null then
    update public.treatment_sessions s
       set planned_date = v_row.start_date + private.session_offset(v_gaps, s.seq)
     where s.treatment_id = p_id and s.status = 'planned' and s.planned_date >= v_today
       and v_row.start_date + private.session_offset(v_gaps, s.seq) >= v_today;
  end if;
  if p_patch ? 'doctor_id' then
    update public.treatment_sessions set doctor_id = v_row.doctor_id
     where treatment_id = p_id and status = 'planned';
  end if;
  -- Closing or cancelling drops the sessions not yet booked.
  if v_row.status in ('closed', 'cancelled') then
    update public.treatment_sessions set status = 'skipped' where treatment_id = p_id and status = 'planned';
  end if;
  return private.treatment_card(p_id);
exception
  when invalid_text_representation or check_violation then
    perform private.fail('invalid_input');
end;
$$;

create function public.add_session(p_treatment_id uuid, p_planned_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.patient_treatments;
  v_seq integer;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_t from public.patient_treatments where id = p_treatment_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_t.status not in ('active', 'on_hold') then
    perform private.fail('invalid_status_change', 'treatment is finished');
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from public.treatment_sessions where treatment_id = p_treatment_id;
  insert into public.treatment_sessions (treatment_id, patient_id, seq, planned_date, doctor_id)
  values (p_treatment_id, v_t.patient_id, v_seq,
          coalesce(p_planned_date, v_t.start_date + private.session_offset(v_t.gap_days, v_seq)), v_t.doctor_id);
  update public.patient_treatments set planned_sessions = greatest(planned_sessions, v_seq), version = version + 1
   where id = p_treatment_id;
  return private.treatment_card(p_treatment_id);
end;
$$;

-- Removing a session keeps the row (history) as 'skipped' with the reason.
create function public.remove_session(p_session_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.treatment_sessions;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('reason_required');
  end if;
  select * into v_s from public.treatment_sessions where id = p_session_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_s.status not in ('planned', 'missed') then
    perform private.fail('invalid_status_change', 'only planned or missed sessions can be removed');
  end if;
  perform set_config('app.reason', btrim(p_reason), true);
  update public.treatment_sessions set status = 'skipped', notes = concat_ws(' · ', notes, btrim(p_reason)) where id = p_session_id;
  return private.treatment_card(v_s.treatment_id);
end;
$$;

-- Session done / missed / back to planned. After "done", suggests the next session
-- ("Book next session?"), and when the plan is finished, creates the follow-up.
create function public.set_session_status(p_session_id uuid, p_status public.session_status, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.treatment_sessions;
  v_t public.patient_treatments;
  v_next public.treatment_sessions;
  v_open integer;
begin
  select * into v_s from public.treatment_sessions where id = p_session_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if p_status not in ('done', 'missed', 'planned') then
    perform private.fail('invalid_status_change');
  end if;
  if v_s.status = 'skipped' or (v_s.status = 'done' and p_status <> 'done') then
    perform private.fail('invalid_status_change');
  end if;
  update public.treatment_sessions
     set status = p_status,
         actual_date = case when p_status = 'done' then coalesce(actual_date, (private.ist(now()))::date) end,
         appointment_id = case when p_status = 'planned' then null else appointment_id end,
         notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_session_id
  returning * into v_s;
  select * into v_t from public.patient_treatments where id = v_s.treatment_id for update;

  select * into v_next from public.treatment_sessions
   where treatment_id = v_s.treatment_id and status = 'planned' order by seq limit 1;
  select count(*) into v_open from public.treatment_sessions
   where treatment_id = v_s.treatment_id and status in ('planned', 'booked');

  if p_status = 'done' and v_open = 0 and v_t.status = 'active' then
    update public.patient_treatments set status = 'completed', version = version + 1 where id = v_t.id;
    if v_t.follow_up_days is not null then
      insert into public.followups (kind, patient_id, due_date, reason, source, ref_table, ref_id, created_by)
      values ('followup', v_t.patient_id, (private.ist(now()))::date + v_t.follow_up_days,
              format('Follow-up after %s', v_t.name), 'session', 'patient_treatments', v_t.id, v_staff)
      on conflict (kind, ref_table, ref_id) where ref_id is not null and status = 'open' do nothing;
    end if;
  end if;
  return jsonb_build_object(
    'treatment', private.treatment_card(v_t.id),
    'book_next', case when p_status = 'done' and v_next.id is not null then
      jsonb_build_object('session_id', v_next.id, 'seq', v_next.seq,
                         'suggested_date', greatest(v_next.planned_date, (private.ist(now()))::date + 1)) end);
end;
$$;

-- Keep sessions in step with their appointment: booked when linked; done when the visit is done;
-- back to planned if the booking is cancelled, missed if it was a no-show. A reschedule inserts the
-- replacement booking with the same session_id and rescheduled_from_id, which re-links the session.
create function private.sync_session_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status not in ('cancelled', 'rescheduled') then
    update public.treatment_sessions set status = 'booked', appointment_id = new.id
     where id = new.session_id
       and (status in ('planned', 'missed')
            or (status = 'booked' and appointment_id = new.rescheduled_from_id));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'done' then
      update public.treatment_sessions set status = 'done', actual_date = new.appt_date
       where id = new.session_id and appointment_id = new.id;
    elsif new.status in ('cancelled', 'no_show') then
      update public.treatment_sessions
         set status = case when new.status = 'no_show' then 'missed'::public.session_status else 'planned' end,
             appointment_id = null
       where id = new.session_id and appointment_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger appointments_session_sync after insert or update of status on public.appointments
  for each row execute function private.sync_session_from_appointment();

-- Patient file: all treatments with their sessions (a patient has a handful, not thousands).
create function public.patient_treatments_list(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(private.treatment_card(t.id)
                     order by (t.status in ('active', 'on_hold')) desc, t.start_date desc, t.id)
    from public.patient_treatments t where t.patient_id = p_patient_id), '[]'::jsonb);
end;
$$;

-- Sessions due in a date range that still need booking (keyset on planned_date, id).
create function public.sessions_due(p_from date, p_to date, p_cursor text default null, p_limit integer default 20)
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
  if p_to < p_from or p_to - p_from > 366 then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  select coalesce(jsonb_agg(x.card order by x.planned_date, x.id), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object('session_id', s.id, 'seq', s.seq, 'planned_date', s.planned_date, 'status', s.status,
             'treatment_id', t.id, 'treatment', t.name, 'planned_sessions', t.planned_sessions,
             'patient_id', p.id, 'patient', p.full_name, 'uhid', p.uhid, 'phone', coalesce(p.whatsapp_e164, p.phone_e164),
             'doctor_id', t.doctor_id) as card, s.planned_date, s.id
    from public.treatment_sessions s
    join public.patient_treatments t on t.id = s.treatment_id and t.status = 'active'
    join public.patients p on p.id = s.patient_id
    where s.status in ('planned', 'missed') and s.planned_date between p_from and p_to
      and (v_c is null or (s.planned_date, s.id) > ((v_c ->> 0)::date, (v_c ->> 1)::uuid))
    order by s.planned_date, s.id
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'planned_date', v_rows -> (v_limit - 1) ->> 'session_id')::text end);
end;
$$;

-- Today board: sessions due this week (counted once, not per day).
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
      join public.patients p on p.id = a.patient_id
      left join public.doctors d on d.id = a.doctor_id
      where a.appt_date = v_day and a.status in ('arrived', 'with_doctor')), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(x.card order by x.slot_start)
      from (
        select private.appt_card(a, p) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name)) as card, a.slot_start
        from public.appointments a
        join public.patients p on p.id = a.patient_id
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

-- Timeline: treatments and sessions join the patient's history.
create or replace function private.patient_events(p_patient_id uuid)
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
  from public.patient_merges m where m.into_id = p_patient_id
  union all
  select coalesce(a.slot_start, a.arrived_at, a.created_at), a.id, 'appointment',
         coalesce(dr.display_name, dr.full_name, 'Walk-in') || ' — ' || a.status::text,
         jsonb_build_object('status', a.status, 'type', a.type, 'doctor_id', a.doctor_id)
  from public.appointments a left join public.doctors dr on dr.id = a.doctor_id
  where a.patient_id = p_patient_id and a.status <> 'rescheduled'
  union all
  select t.created_at, t.id, 'treatment', 'Started ' || t.name, jsonb_build_object('treatment_id', t.id, 'status', t.status)
  from public.patient_treatments t where t.patient_id = p_patient_id
  union all
  select private.ist_at(s.actual_date, '12:00'), s.id, 'session',
         format('%s — session %s done', t.name, s.seq), jsonb_build_object('treatment_id', t.id, 'seq', s.seq)
  from public.treatment_sessions s join public.patient_treatments t on t.id = s.treatment_id
  where s.patient_id = p_patient_id and s.status = 'done' and s.actual_date is not null;
$$;

grant execute on function
  public.start_treatment(jsonb, uuid),
  public.update_treatment(uuid, jsonb, integer, text),
  public.add_session(uuid, date),
  public.remove_session(uuid, text),
  public.set_session_status(uuid, public.session_status, text),
  public.patient_treatments_list(uuid),
  public.sessions_due(date, date, text, integer)
to authenticated;

select private.lock_down_public_functions();
