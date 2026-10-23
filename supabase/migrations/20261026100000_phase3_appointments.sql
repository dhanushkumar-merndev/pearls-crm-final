-- Pearl CRM — Phase 3: appointments, walk-ins, Today board, follow-ups, reception dashboard
-- (PLAN.md C3 "Care", C4 "Slot capacity", D2 "Doctors and slots", "Appointments, walk-ins, Today").
-- Every per-slot count is ONE grouped query joined onto the slot series — never a
-- subquery per slot (CLAUDE.md scale rule).

create type public.appt_status as enum (
  'pending_confirmation', 'confirmed', 'arrived', 'with_doctor', 'done', 'no_show', 'cancelled', 'rescheduled'
);
create type public.appt_type as enum ('consultation', 'session', 'procedure', 'surgery', 'follow_up', 'review');
create type public.appt_mode as enum ('offline', 'online');
create type public.confirm_via as enum ('reception', 'sales_call', 'whatsapp', 'auto');
create type public.followup_kind as enum ('followup', 'call_to_confirm', 'reschedule_request', 'review_recording', 'other');
create type public.followup_status as enum ('open', 'done', 'cancelled');

------------------------------------------------------------------------------
-- Appointments
------------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients (id),
  lead_id uuid,                      -- FK added in Phase 9
  doctor_id uuid references public.doctors (id),
  appt_date date not null,           -- IST calendar day
  slot_start timestamptz,            -- null only for a walk-in waiting in the queue
  slot_end timestamptz,
  type public.appt_type not null default 'consultation',
  mode public.appt_mode not null default 'offline',
  status public.appt_status not null default 'pending_confirmation',
  is_walk_in boolean not null default false,
  queue_no integer check (queue_no > 0),
  confirmed_via public.confirm_via,
  confirmed_at timestamptz,
  confirmed_by uuid references public.staff (id),
  treatment_id uuid,                 -- FK added in Phase 4
  session_id uuid,                   -- FK added in Phase 4
  source_id uuid references public.lookup_values (id),
  booked_by uuid references public.staff (id),
  booked_from text not null default 'web' check (booked_from in ('web', 'android', 'whatsapp', 'system')),
  notes text check (length(notes) <= 1000),
  rescheduled_from_id uuid references public.appointments (id),
  arrived_at timestamptz,
  with_doctor_at timestamptz,
  done_at timestamptz,
  cancel_reason text check (length(cancel_reason) <= 300),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (patient_id is not null or lead_id is not null),
  check (slot_start is not null or (is_walk_in and queue_no is not null)),
  check (slot_end is null or slot_end > slot_start)
);
-- Capacity counts: only bookings that still hold their place.
create index appointments_slot on public.appointments (doctor_id, slot_start)
  where status not in ('cancelled', 'rescheduled');
create index appointments_day on public.appointments (appt_date, status);
create index appointments_patient on public.appointments (patient_id, slot_start desc) where patient_id is not null;
create index appointments_lead on public.appointments (lead_id) where lead_id is not null;
create unique index appointments_queue on public.appointments (appt_date, queue_no) where queue_no is not null;
create trigger appointments_touch before update on public.appointments
  for each row execute function private.touch_updated();
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function private.audit_row();

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id),
  appointment_id uuid unique references public.appointments (id),
  doctor_id uuid references public.doctors (id),
  visit_date date not null,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  complaints text check (length(complaints) <= 2000),
  notes text check (length(notes) <= 4000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index visits_patient on public.visits (patient_id, visit_date desc);
create index visits_day on public.visits (visit_date);
create trigger visits_touch before update on public.visits
  for each row execute function private.touch_updated();
alter table public.documents add constraint documents_visit_fk foreign key (visit_id) references public.visits (id);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  kind public.followup_kind not null default 'followup',
  patient_id uuid references public.patients (id),
  lead_id uuid,                      -- FK added in Phase 9
  due_date date not null,
  due_at timestamptz,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  source text not null default 'manual' check (source in ('session', 'discharge', 'doctor', 'manual', 'sales', 'system')),
  assigned_to uuid references public.staff (id), -- empty = reception queue
  status public.followup_status not null default 'open',
  done_at timestamptz,
  done_by uuid references public.staff (id),
  outcome text check (length(outcome) <= 500),
  ref_table text,
  ref_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (patient_id is not null or lead_id is not null)
);
create index followups_due on public.followups (status, due_date);
create index followups_assignee on public.followups (assigned_to, status, due_date);
create index followups_patient on public.followups (patient_id) where patient_id is not null;
create unique index followups_ref_once on public.followups (kind, ref_table, ref_id) where ref_id is not null and status = 'open';
create trigger followups_touch before update on public.followups
  for each row execute function private.touch_updated();

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------
alter table public.appointments enable row level security;
alter table public.visits enable row level security;
alter table public.followups enable row level security;
grant select on public.appointments, public.visits, public.followups to authenticated;

create policy appointments_select on public.appointments for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
create policy visits_select on public.visits for select to authenticated
  using ((select private.has_role('receptionist', 'admin')));
-- Reception: the reception queue (no assignee), their own, and patient follow-ups. Others: their own.
create policy followups_select on public.followups for select to authenticated
  using (
    (select private.has_role('admin'))
    or assigned_to = (select private.my_staff_id())
    or ((select private.has_role('receptionist')) and (assigned_to is null or patient_id is not null))
  );

alter publication supabase_realtime add table public.appointments;

------------------------------------------------------------------------------
-- Slots
------------------------------------------------------------------------------
-- The instant of an IST wall-clock time on an IST date.
create function private.ist_at(p_date date, p_time time)
returns timestamptz
language sql
immutable
parallel safe
as $$
  select ((p_date + p_time) - interval '5 hours 30 minutes') at time zone 'UTC';
$$;

-- Every bookable slot for one doctor on one IST day (from weekly hours valid that day).
create function private.doctor_slots(p_doctor_id uuid, p_date date)
returns table (slot_start timestamptz, slot_end timestamptz, capacity integer)
language sql
stable
security definer
set search_path = ''
as $$
  select private.ist_at(p_date, s.start_time) + (n * len),
         private.ist_at(p_date, s.start_time) + ((n + 1) * len),
         coalesce(d.capacity_override, s.capacity,
                  (private.setting('appointments', 'capacity_per_slot', '3'))::int)::int
  from public.doctor_schedules s
  join public.doctors d on d.id = s.doctor_id and d.active
  cross join lateral (
    select make_interval(mins => coalesce(s.slot_minutes, d.slot_minutes,
                                          (private.setting('appointments', 'slot_minutes', '15'))::int)) as len
  ) l
  -- Whole slots only: a 50-minute block with 15-minute slots gives 3 slots, never one past closing.
  cross join lateral generate_series(
    0, floor(extract(epoch from (s.end_time - s.start_time)) / extract(epoch from l.len))::int - 1) n
  where s.doctor_id = p_doctor_id
    and s.weekday = extract(isodow from p_date)
    and p_date between s.valid_from and coalesce(s.valid_to, 'infinity'::date);
$$;

-- Why a day/slot can't be booked: holiday, leave, past. null = bookable.
create function private.blocked_reason(p_doctor_id uuid, p_start timestamptz, p_end timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.holidays h where h.day = (private.ist(p_start))::date) then 'holiday'
    when exists (select 1 from public.doctor_leaves l where l.doctor_id = p_doctor_id
                   and l.during && tstzrange(p_start, p_end)) then 'doctor_on_leave'
    when p_end <= now() then 'past'
  end;
$$;

-- Free slots for a doctor on a date: one grouped count of bookings, joined onto the slot series.
create function public.get_free_slots(p_doctor_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'start', s.slot_start, 'end', s.slot_end, 'capacity', s.capacity,
             'booked', coalesce(b.n, 0), 'left', greatest(s.capacity - coalesce(b.n, 0), 0),
             'blocked_reason', private.blocked_reason(p_doctor_id, s.slot_start, s.slot_end))
           order by s.slot_start)
    from private.doctor_slots(p_doctor_id, p_date) s
    left join (
      select a.slot_start, count(*)::int as n
      from public.appointments a
      where a.doctor_id = p_doctor_id and a.appt_date = p_date and a.status not in ('cancelled', 'rescheduled')
        and a.slot_start is not null
      group by a.slot_start
    ) b on b.slot_start = s.slot_start), '[]'::jsonb);
end;
$$;

------------------------------------------------------------------------------
-- Booking (PLAN.md C4): lock the (doctor, slot), count, compare, insert — one transaction.
-- 10 people booking the same 3-place slot at once → exactly 3 succeed.
------------------------------------------------------------------------------
create function private.lock_slot(p_doctor_id uuid, p_start timestamptz)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended(p_doctor_id::text || '|' || p_start::text, 42));
$$;

create function private.check_slot(p_doctor_id uuid, p_start timestamptz, p_exclude uuid default null)
returns table (slot_start timestamptz, slot_end timestamptz, capacity integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot record;
  v_reason text;
  v_booked integer;
begin
  select * into v_slot from private.doctor_slots(p_doctor_id, (private.ist(p_start))::date) s where s.slot_start = p_start;
  if not found then
    perform private.fail('outside_schedule');
  end if;
  v_reason := private.blocked_reason(p_doctor_id, v_slot.slot_start, v_slot.slot_end);
  if v_reason = 'past' then
    perform private.fail('slot_in_past');
  elsif v_reason is not null then
    perform private.fail(v_reason);
  end if;
  select count(*) into v_booked from public.appointments a
   where a.doctor_id = p_doctor_id and a.slot_start = p_start and a.status not in ('cancelled', 'rescheduled')
     and (p_exclude is null or a.id <> p_exclude);
  if v_booked >= v_slot.capacity then
    perform private.fail('slot_full');
  end if;
  return query select v_slot.slot_start, v_slot.slot_end, v_slot.capacity;
end;
$$;

create function public.book_appointment(p_booking jsonb, p_client_id uuid)
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
  -- Reception books patients; sales book leads (Phase 9 checks assignment).
  if v_patient is not null and not private.has_role('receptionist', 'admin') then
    perform private.fail('not_allowed');
  end if;
  if v_patient is not null and not exists (select 1 from public.patients where id = v_patient and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
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
    case when v_confirm then 'reception'::public.confirm_via end,
    case when v_confirm then now() end, case when v_confirm then v_staff end,
    (p_booking ->> 'source_id')::uuid, v_staff,
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

-- Walk-in: into the doctor's current slot if it has room, otherwise into today's queue.
create function public.book_walk_in(p_patient_id uuid, p_doctor_id uuid default null, p_notes text default null, p_client_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_today date := (private.ist(now()))::date;
  v_slot record;
  v_booked integer;
  v_row public.appointments;
  v_queue integer;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  select * into v_row from public.appointments where id = p_client_id;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;
  if not exists (select 1 from public.patients where id = p_patient_id and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
  end if;

  if p_doctor_id is not null then
    select * into v_slot from private.doctor_slots(p_doctor_id, v_today) s
     where now() >= s.slot_start and now() < s.slot_end;
    if found and private.blocked_reason(p_doctor_id, v_slot.slot_start, v_slot.slot_end) is null then
      perform private.lock_slot(p_doctor_id, v_slot.slot_start);
      select count(*) into v_booked from public.appointments a
       where a.doctor_id = p_doctor_id and a.slot_start = v_slot.slot_start and a.status not in ('cancelled', 'rescheduled');
      if v_booked < v_slot.capacity then
        insert into public.appointments (id, patient_id, doctor_id, appt_date, slot_start, slot_end, status, is_walk_in,
                                         arrived_at, booked_by, notes)
        values (p_client_id, p_patient_id, p_doctor_id, v_today, v_slot.slot_start, v_slot.slot_end, 'arrived', true,
                now(), v_staff, nullif(btrim(p_notes), ''))
        returning * into v_row;
        insert into public.visits (patient_id, appointment_id, doctor_id, visit_date)
        values (p_patient_id, v_row.id, p_doctor_id, v_today);
        return to_jsonb(v_row) || jsonb_build_object('repeat', false, 'queued', false);
      end if;
    end if;
  end if;

  -- Full (or no doctor chosen): today's queue. Numbers are per day, under a day lock.
  perform pg_advisory_xact_lock(hashtextextended('queue|' || v_today::text, 42));
  select coalesce(max(queue_no), 0) + 1 into v_queue from public.appointments where appt_date = v_today and queue_no is not null;
  insert into public.appointments (id, patient_id, doctor_id, appt_date, status, is_walk_in, queue_no, arrived_at, booked_by, notes)
  values (p_client_id, p_patient_id, p_doctor_id, v_today, 'arrived', true, v_queue, now(), v_staff, nullif(btrim(p_notes), ''))
  returning * into v_row;
  insert into public.visits (patient_id, appointment_id, doctor_id, visit_date)
  values (p_patient_id, v_row.id, p_doctor_id, v_today);
  return to_jsonb(v_row) || jsonb_build_object('repeat', false, 'queued', true);
end;
$$;

-- Allowed status changes (PLAN.md D2). Anything else is refused.
create function private.appt_transition_ok(p_from public.appt_status, p_to public.appt_status)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('pending_confirmation', 'confirmed'), ('pending_confirmation', 'arrived'), ('pending_confirmation', 'cancelled'),
    ('pending_confirmation', 'no_show'),
    ('confirmed', 'arrived'), ('confirmed', 'cancelled'), ('confirmed', 'no_show'), ('confirmed', 'pending_confirmation'),
    ('arrived', 'with_doctor'), ('arrived', 'done'), ('arrived', 'cancelled'),
    ('with_doctor', 'done'), ('with_doctor', 'arrived'),
    ('no_show', 'arrived')
  );
$$;

create function public.set_appointment_status(p_id uuid, p_status public.appt_status, p_reason text default null, p_version integer default null)
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
  -- Sales may only confirm or cancel lead bookings (assignment is checked in Phase 9).
  if not private.has_role('receptionist', 'admin') and (p_status not in ('confirmed', 'cancelled') or v_row.lead_id is null) then
    perform private.fail('not_allowed');
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

-- Move a booking to another slot (same or another doctor). The old one is kept as 'rescheduled'.
create function public.reschedule_appointment(p_id uuid, p_new_start timestamptz, p_doctor_id uuid default null,
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

-- Bookings that a new leave would hit (shown before saving the leave).
create function public.leave_conflicts(p_doctor_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'slot_start', a.slot_start, 'status', a.status,
             'patient', p.full_name, 'uhid', p.uhid, 'phone', p.phone_e164) order by a.slot_start)
    from public.appointments a left join public.patients p on p.id = a.patient_id
    where a.doctor_id = p_doctor_id and a.slot_start >= p_from and a.slot_start < p_to
      and a.status in ('pending_confirmation', 'confirmed')), '[]'::jsonb);
end;
$$;

------------------------------------------------------------------------------
-- Boards and tables
------------------------------------------------------------------------------
create function private.appt_card(a public.appointments, p public.patients)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', a.id, 'status', a.status, 'type', a.type, 'mode', a.mode, 'slot_start', a.slot_start, 'slot_end', a.slot_end,
    'doctor_id', a.doctor_id, 'is_walk_in', a.is_walk_in, 'queue_no', a.queue_no, 'version', a.version,
    'patient_id', a.patient_id, 'lead_id', a.lead_id, 'patient', p.full_name, 'uhid', p.uhid,
    'phone', coalesce(p.whatsapp_e164, p.phone_e164), 'arrived_at', a.arrived_at, 'notes', a.notes);
$$;

-- Slot board: doctors × slots with the booking chips, for one IST day.
create function public.slot_board(p_date date, p_doctor_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'sales_manager', 'admin']::public.staff_role[]);
  return jsonb_build_object(
    'date', p_date,
    'holiday', (select name from public.holidays where day = p_date),
    'doctors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', coalesce(d.display_name, d.full_name), 'colour_slot', d.colour_slot,
               'on_leave', exists (select 1 from public.doctor_leaves l where l.doctor_id = d.id
                                     and l.during && tstzrange(private.ist_at(p_date, '00:00'), private.ist_at(p_date + 1, '00:00'))),
               'slots', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'start', s.slot_start, 'end', s.slot_end, 'capacity', s.capacity,
                          'blocked_reason', private.blocked_reason(d.id, s.slot_start, s.slot_end),
                          'chips', coalesce(c.chips, '[]'::jsonb))
                        order by s.slot_start)
                 from private.doctor_slots(d.id, p_date) s
                 left join (
                   -- one grouped pass over the day's bookings for this doctor
                   select a.slot_start, jsonb_agg(private.appt_card(a, p) order by a.created_at) as chips
                   from public.appointments a left join public.patients p on p.id = a.patient_id
                   where a.doctor_id = d.id and a.appt_date = p_date and a.status not in ('cancelled', 'rescheduled')
                     and a.slot_start is not null
                   group by a.slot_start
                 ) c on c.slot_start = s.slot_start), '[]'::jsonb))
             order by d.sort, d.full_name)
      from public.doctors d
      where d.active and (p_doctor_ids is null or d.id = any (p_doctor_ids))), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(private.appt_card(a, p) order by a.queue_no)
      from public.appointments a left join public.patients p on p.id = a.patient_id
      where a.appt_date = p_date and a.queue_no is not null and a.status in ('arrived', 'with_doctor')), '[]'::jsonb));
end;
$$;

-- Admin / reception table: filters + sort + offset paging with an exact count (max 100 rows).
create function public.appointments_table(p_filters jsonb default '{}', p_sort text default 'slot_start',
                                          p_desc boolean default false, p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_from date := coalesce((p_filters ->> 'from')::date, (private.ist(now()))::date);
  v_to date := coalesce((p_filters ->> 'to')::date, v_from);
  v_statuses public.appt_status[] := case when p_filters ? 'statuses'
    then array(select jsonb_array_elements_text(p_filters -> 'statuses'))::public.appt_status[] end;
  v_doctor uuid := (p_filters ->> 'doctor_id')::uuid;
  v_order text := case p_sort when 'patient' then '(f.p).full_name' when 'status' then '(f.a).status::text'
                              when 'doctor' then 'f.doctor' else '(f.a).slot_start' end;
  v_result jsonb;
begin
  perform private.require_staff(array['receptionist', 'sales_manager', 'admin']::public.staff_role[]);
  if v_to < v_from or v_to - v_from > 366 then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  execute format($q$
    with filtered as (
      select a, p, d.full_name as doctor
      from public.appointments a
      left join public.patients p on p.id = a.patient_id
      left join public.doctors d on d.id = a.doctor_id
      where a.appt_date between $1 and $2
        and ($3::public.appt_status[] is null or a.status = any ($3))
        and ($4::uuid is null or a.doctor_id = $4)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(private.appt_card(x.a, x.p) || jsonb_build_object('doctor', x.doctor))
        from (select * from filtered f order by %s %s nulls last, (f.a).id limit $5 offset $6) x), '[]'::jsonb))
  $q$, v_order, case when p_desc then 'desc' else 'asc' end)
  into v_result using v_from, v_to, v_statuses, v_doctor, v_limit, greatest(coalesce(p_offset, 0), 0);
  return v_result;
end;
$$;

-- Today board: everything reception needs for the day, in one call.
create function public.today_board(p_date date default null)
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
    'pending_registrations', (select count(*) from public.registration_requests where status = 'pending'));
end;
$$;

-- Bookings still waiting for a confirmation (soonest first, keyset).
create function public.needs_confirmation(p_cursor text default null, p_limit integer default 20)
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
  perform private.require_staff(array['receptionist', 'sales_manager', 'admin']::public.staff_role[]);
  select coalesce(jsonb_agg(x.card order by x.slot_start, x.id), '[]'::jsonb) into v_rows
  from (
    select private.appt_card(a, p) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name)) as card,
           a.slot_start, a.id
    from public.appointments a
    left join public.patients p on p.id = a.patient_id
    left join public.doctors d on d.id = a.doctor_id
    where a.status = 'pending_confirmation' and a.slot_start > now()
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

------------------------------------------------------------------------------
-- Follow-ups / tasks
------------------------------------------------------------------------------
create function public.create_followup(p_followup jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_row public.followups;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  insert into public.followups (id, kind, patient_id, lead_id, due_date, due_at, reason, source, assigned_to, ref_table, ref_id)
  values (p_client_id, coalesce((p_followup ->> 'kind')::public.followup_kind, 'followup'),
          (p_followup ->> 'patient_id')::uuid, (p_followup ->> 'lead_id')::uuid,
          coalesce((p_followup ->> 'due_date')::date, (private.ist(now()))::date), (p_followup ->> 'due_at')::timestamptz,
          btrim(p_followup ->> 'reason'),
          case when private.has_role('sales_executive', 'sales_manager') then 'sales' else 'manual' end,
          -- Sales follow-ups are theirs; reception's go to the shared queue unless assigned.
          coalesce((p_followup ->> 'assigned_to')::uuid,
                   case when private.has_role('sales_executive', 'sales_manager') then v_staff end),
          p_followup ->> 'ref_table', (p_followup ->> 'ref_id')::uuid)
  on conflict (id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.followups where id = p_client_id;
  end if;
  return to_jsonb(v_row);
exception
  when check_violation or not_null_violation then
    perform private.fail('invalid_input', 'reason');
end;
$$;

create function public.complete_followup(p_id uuid, p_outcome text default null, p_cancel boolean default false)
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
  return to_jsonb(v_row);
end;
$$;

-- today = due today; overdue = before today; upcoming = after today. Keyset on (due_date, id).
create function public.followups_list(p_scope text default 'today', p_assignee uuid default null, p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff();
  v_today date := (private.ist(now()))::date;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
begin
  if p_scope not in ('today', 'overdue', 'upcoming') then
    perform private.fail('invalid_input', 'scope');
  end if;
  select coalesce(jsonb_agg(x.card order by x.due_date, x.id), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object('id', f.id, 'kind', f.kind, 'due_date', f.due_date, 'due_at', f.due_at, 'reason', f.reason,
             'source', f.source, 'assigned_to', f.assigned_to, 'patient_id', f.patient_id, 'lead_id', f.lead_id,
             'patient', p.full_name, 'uhid', p.uhid, 'phone', coalesce(p.whatsapp_e164, p.phone_e164),
             'ref_table', f.ref_table, 'ref_id', f.ref_id) as card, f.due_date, f.id
    from public.followups f left join public.patients p on p.id = f.patient_id
    where f.status = 'open'
      and case p_scope when 'today' then f.due_date = v_today when 'overdue' then f.due_date < v_today
                       else f.due_date > v_today end
      and (p_assignee is null or f.assigned_to = p_assignee)
      and (private.has_role('admin') or f.assigned_to = v_staff
           or (private.has_role('receptionist') and (f.assigned_to is null or f.patient_id is not null))
           or (private.has_role('sales_manager') and f.source = 'sales'))
      and (v_c is null or (f.due_date, f.id) > ((v_c ->> 0)::date, (v_c ->> 1)::uuid))
    order by f.due_date, f.id
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'due_date', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

-- Every 15 minutes: bookings still not confirmed N hours before → a "Call to confirm" task (once each).
create function private.appointment_confirm_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer := (private.setting('appointments', 'confirm_hours_before', '4'))::int;
  v_n integer;
begin
  insert into public.followups (kind, patient_id, lead_id, due_date, due_at, reason, source, ref_table, ref_id)
  select 'call_to_confirm', a.patient_id, a.lead_id, a.appt_date, a.slot_start,
         'Call to confirm the appointment', 'system', 'appointments', a.id
  from public.appointments a
  where a.status = 'pending_confirmation'
    and a.slot_start > now() and a.slot_start <= now() + make_interval(hours => v_hours)
  on conflict (kind, ref_table, ref_id) where ref_id is not null and status = 'open' do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

------------------------------------------------------------------------------
-- Reception dashboard (PLAN.md B6): tiles + arrivals by hour (today vs the typical
-- same weekday over the last 8 weeks) + doctor load by status. One call.
-- Collections join in Phase 5.
------------------------------------------------------------------------------
create function public.dashboard_reception(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_date, (private.ist(now()))::date);
  v_past date[] := array(select v_day - (7 * w) from generate_series(1, 8) w);
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return jsonb_build_object(
    'date', v_day,
    'tiles', public.today_board(v_day) -> 'counts',
    'arrivals_by_hour', (
      select jsonb_agg(jsonb_build_object('hour', h, 'today', coalesce(t.n, 0), 'typical', round(coalesce(p.n, 0) / 8.0, 1)) order by h)
      from generate_series(7, 21) h
      left join (
        select extract(hour from private.ist(a.arrived_at))::int as hour, count(*) as n
        from public.appointments a where a.appt_date = v_day and a.arrived_at is not null group by 1
      ) t on t.hour = h
      left join (
        select extract(hour from private.ist(a.arrived_at))::int as hour, count(*) as n
        from public.appointments a where a.appt_date = any (v_past) and a.arrived_at is not null group by 1
      ) p on p.hour = h),
    'doctor_load', coalesce((
      select jsonb_agg(jsonb_build_object('doctor', coalesce(d.display_name, d.full_name), 'counts', x.counts)
                       order by d.sort, d.full_name)
      from (
        select a.doctor_id, jsonb_object_agg(a.status, a.n) as counts
        from (select doctor_id, status, count(*) as n from public.appointments
               where appt_date = v_day and doctor_id is not null and status not in ('cancelled', 'rescheduled')
               group by doctor_id, status) a
        group by a.doctor_id
      ) x join public.doctors d on d.id = x.doctor_id), '[]'::jsonb),
    'followups', jsonb_build_object(
      'due', (select count(*) from public.followups where status = 'open' and due_date = v_day),
      'overdue', (select count(*) from public.followups where status = 'open' and due_date < v_day)));
end;
$$;

-- Timeline: appointments and visits join the patient's history.
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
  where a.patient_id = p_patient_id and a.status <> 'rescheduled';
$$;

-- Patient file tab: appointments (newest first, keyset).
create function public.patient_appointments(p_patient_id uuid, p_cursor text default null, p_limit integer default 20)
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
  select coalesce(jsonb_agg(x.card order by x.at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select private.appt_card(a, p) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name), 'appt_date', a.appt_date) as card,
           coalesce(a.slot_start, a.arrived_at) as at, a.id
    from public.appointments a
    join public.patients p on p.id = a.patient_id
    left join public.doctors d on d.id = a.doctor_id
    where a.patient_id = p_patient_id
      and (v_c is null or (coalesce(a.slot_start, a.arrived_at), a.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by coalesce(a.slot_start, a.arrived_at) desc, a.id desc
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(coalesce(v_rows -> (v_limit - 1) ->> 'slot_start', v_rows -> (v_limit - 1) ->> 'arrived_at'),
                        v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

------------------------------------------------------------------------------
-- Scheduled job (pg_cron, UTC): call-to-confirm tasks every 15 minutes.
------------------------------------------------------------------------------
create extension if not exists pg_cron;
select cron.schedule('appointment-confirm-tasks', '*/15 * * * *', $$select private.appointment_confirm_tasks()$$);

grant execute on function
  public.get_free_slots(uuid, date),
  public.book_appointment(jsonb, uuid),
  public.book_walk_in(uuid, uuid, text, uuid),
  public.set_appointment_status(uuid, public.appt_status, text, integer),
  public.reschedule_appointment(uuid, timestamptz, uuid, text, uuid),
  public.leave_conflicts(uuid, timestamptz, timestamptz),
  public.slot_board(date, uuid[]),
  public.appointments_table(jsonb, text, boolean, integer, integer),
  public.today_board(date),
  public.needs_confirmation(text, integer),
  public.create_followup(jsonb, uuid),
  public.complete_followup(uuid, text, boolean),
  public.followups_list(text, uuid, text, integer),
  public.dashboard_reception(date),
  public.patient_appointments(uuid, text, integer)
to authenticated;

select private.lock_down_public_functions();
