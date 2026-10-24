-- Phase 12: call recordings and voice notes (PLAN.md E3 row 12, C2 recordings).
-- The phone finds the dialer's recording for a call, registers it here ("On phone"), and
-- uploads it (first N minutes, compressed) when the admin's mode says so or a manager asks.
-- Files go through files-sign like every other upload; this table says what each file is.

create type public.recording_kind as enum ('call', 'visit', 'voice_note');
create type public.recording_status as enum ('on_phone', 'queued', 'uploading', 'synced', 'failed', 'archived');

create table public.recordings (
  id uuid primary key,                         -- made on the phone (retries never duplicate)
  kind public.recording_kind not null,
  staff_id uuid not null references public.staff (id),
  call_log_id uuid references public.call_logs (id) on delete set null,
  site_visit_id uuid,                          -- Phase 13 adds the foreign key
  lead_id uuid references public.leads (id) on delete set null,
  patient_id uuid references public.patients (id) on delete set null,
  recorded_at timestamptz not null,
  duration_s integer not null default 0 check (duration_s between 0 and 86400),
  uploaded_s integer check (uploaded_s between 0 and 86400),
  trimmed boolean not null default false,
  status public.recording_status not null default 'on_phone',
  match_confidence numeric(3, 2) check (match_confidence between 0 and 1),
  needs_review boolean not null default false,
  sync_requested_by uuid references public.staff (id),
  sync_requested_at timestamptz,
  file_id uuid references public.files (id),
  error text check (length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index recordings_staff on public.recordings (staff_id, recorded_at desc);
create index recordings_lead on public.recordings (lead_id, recorded_at desc) where lead_id is not null;
create index recordings_recent on public.recordings (recorded_at desc, id);
create index recordings_requested on public.recordings (staff_id) where sync_requested_at is not null and status <> 'synced';
create unique index recordings_one_per_call on public.recordings (call_log_id) where call_log_id is not null;
create trigger recordings_touch before update on public.recordings
  for each row execute function private.touch_updated();

-- Phase 9 left these two columns waiting for this table.
alter table public.call_logs add constraint call_logs_recording_fk
  foreign key (recording_id) references public.recordings (id) on delete set null;
alter table public.leads add constraint leads_lost_recording_fk
  foreign key (lost_recording_id) references public.recordings (id) on delete set null;

-- Reception may play call recordings of patients only when the admin allows it (Settings → Sales).
create function private.reception_plays_recordings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.setting('sales', 'reception_can_play_recordings', 'false'::jsonb))::text = 'true', false);
$$;
grant execute on function private.reception_plays_recordings() to authenticated;

alter table public.recordings enable row level security;
grant select on public.recordings to authenticated;
create policy recordings_select on public.recordings for select to authenticated
  using (
    (select private.has_role('admin'))
    or staff_id = (select private.my_staff_id())
    or ((select private.has_role('sales_manager')) and kind in ('call', 'voice_note'))
    or ((select private.has_role('receptionist')) and kind = 'call' and patient_id is not null
        and (select private.reception_plays_recordings()))
  );

-- Files: the same people may open the audio itself.
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    (select private.has_role('admin'))
    or owner_staff_id = (select private.my_staff_id())
    or (patient_id is not null and (select private.has_role('receptionist'))
        and purpose in ('prescription', 'document', 'registration_form', 'patient_photo', 'pdf', 'thumbnail'))
    or (purpose in ('call_recording', 'voice_note') and (select private.has_role('sales_manager')))
    or (purpose = 'call_recording' and patient_id is not null and (select private.has_role('receptionist'))
        and (select private.reception_plays_recordings()))
  );

-- Upload mode for one person: their override, else the clinic setting. sync_only = only when asked.
create function private.recording_mode(p_staff uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.recording_upload_override from public.staff s where s.id = p_staff),
    nullif(private.setting('sales', 'recording_upload_mode', '"sync_only"'::jsonb) #>> '{}', ''),
    'sync_only');
$$;

------------------------------------------------------------------------------
-- Phone side
------------------------------------------------------------------------------
-- What the phone should do: upload mode, how many seconds to keep, and recordings a manager asked for.
create function public.recording_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]);
begin
  return jsonb_build_object(
    'mode', private.recording_mode(v_me),
    'max_seconds', 60 * least(greatest(coalesce((private.setting('sales', 'recording_max_minutes', '10'::jsonb) #>> '{}')::int, 10), 1), 60),
    'requested', coalesce((
      select jsonb_agg(r.id order by r.sync_requested_at)
      from public.recordings r
      where r.staff_id = v_me and r.sync_requested_at is not null and r.status not in ('synced', 'archived')), '[]'::jsonb));
end;
$$;

-- rows: [{id, kind, call_log_id?, lead_id?, recorded_at, duration_s, match_confidence?, needs_review?, lost_note?}]
-- Registers recordings found on the phone (idempotent per id). Managers see them as "On phone".
create function public.recording_register(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]);
  v_all boolean := private.has_role('sales_manager', 'admin');
  v_n integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    perform private.fail('invalid_input', 'at most 200 rows per batch');
  end if;

  with r as (
    select (e ->> 'id')::uuid as id, (e ->> 'kind')::public.recording_kind as kind,
           nullif(e ->> 'call_log_id', '')::uuid as call_log_id, nullif(e ->> 'lead_id', '')::uuid as lead_id,
           (e ->> 'recorded_at')::timestamptz as recorded_at,
           least(greatest(coalesce((e ->> 'duration_s')::int, 0), 0), 86400) as duration_s,
           least(greatest((e ->> 'match_confidence')::numeric, 0), 1) as match_confidence,
           coalesce((e ->> 'needs_review')::boolean, false) as needs_review,
           coalesce((e ->> 'lost_note')::boolean, false) as lost_note
    from jsonb_array_elements(p_rows) e
    where (e ->> 'id') is not null and (e ->> 'recorded_at') is not null
  ), linked as (
    -- Only the caller's own calls, and only leads they may work on.
    select r.*, c.id as own_call,
           coalesce(c.lead_id, l.id) as the_lead,
           coalesce(c.patient_id, l.patient_id) as the_patient
    from r
    left join public.call_logs c on c.id = r.call_log_id and c.staff_id = v_me
    left join public.leads l on l.id = r.lead_id and l.deleted_at is null and (v_all or l.assigned_to = v_me)
  ), ins as (
    insert into public.recordings (id, kind, staff_id, call_log_id, lead_id, patient_id, recorded_at, duration_s,
                                   match_confidence, needs_review)
    select id, kind, v_me, own_call, the_lead, the_patient, recorded_at, duration_s, match_confidence, needs_review
    from linked
    on conflict do nothing
    returning id, call_log_id, lead_id, kind
  ), calls as (
    update public.call_logs c set recording_id = i.id from ins i where c.id = i.call_log_id and c.recording_id is null
    returning c.id
  ), lost as (
    update public.leads l set lost_recording_id = i.id
    from ins i join linked x on x.id = i.id
    where i.kind = 'voice_note' and x.lost_note and l.id = i.lead_id and l.stage = 'lost'
    returning l.id
  )
  select count(*) into v_n from ins;

  return jsonb_build_object('registered', v_n, 'skipped', jsonb_array_length(p_rows) - v_n) || public.recording_tasks();
exception
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
    perform private.fail('invalid_input');
end;
$$;

-- After files-sign confirmed the upload: the recording now has its audio.
create function public.recording_attach(p_id uuid, p_file_id uuid, p_uploaded_s integer, p_trimmed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]);
  v_rec public.recordings;
  v_file public.files;
begin
  select * into v_rec from public.recordings where id = p_id and staff_id = v_me for update;
  if not found then
    perform private.fail('not_found', 'recording');
  end if;
  select * into v_file from public.files where id = p_file_id and owner_staff_id = v_me;
  if not found or v_file.status <> 'uploaded' then
    perform private.fail('not_found', 'file');
  end if;
  if v_file.purpose not in ('call_recording', 'voice_note', 'visit_recording') then
    perform private.fail('invalid_input', 'file purpose');
  end if;
  if v_rec.file_id is not null and v_rec.file_id <> p_file_id then
    perform private.fail('duplicate', 'recording already has its file');
  end if;
  update public.recordings set
    file_id = p_file_id, status = 'synced', error = null,
    uploaded_s = least(greatest(coalesce(p_uploaded_s, duration_s), 0), 86400),
    trimmed = coalesce(p_trimmed, false)
  where id = p_id
  returning * into v_rec;
  update public.files set linked_table = 'recordings', linked_id = p_id,
                          lead_id = coalesce(lead_id, v_rec.lead_id), patient_id = coalesce(patient_id, v_rec.patient_id)
   where id = p_file_id;
  return to_jsonb(v_rec);
end;
$$;

create function public.recording_failed(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]);
begin
  update public.recordings set status = 'failed', error = left(coalesce(nullif(btrim(p_error), ''), 'unknown'), 500)
   where id = p_id and staff_id = v_me and status <> 'synced';
end;
$$;

------------------------------------------------------------------------------
-- Manager side
------------------------------------------------------------------------------
-- "Request sync": the phone uploads this recording at its next sync; its owner gets a push.
create function public.request_recording_sync(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_manager', 'admin']::public.staff_role[]);
  v_rec public.recordings;
  v_lead text;
begin
  select * into v_rec from public.recordings where id = p_id for update;
  if not found or (v_rec.kind = 'visit' and not private.has_role('admin')) then
    perform private.fail('not_found', 'recording');
  end if;
  if v_rec.status in ('synced', 'archived') then
    return to_jsonb(v_rec);
  end if;
  update public.recordings set sync_requested_by = v_me, sync_requested_at = now(),
                               status = case when status in ('on_phone', 'failed') then 'queued' else status end
   where id = p_id
  returning * into v_rec;
  select l.name into v_lead from public.leads l where l.id = v_rec.lead_id;
  insert into public.notifications (recipient_id, type, title, body, data, dedupe_key)
  values (v_rec.staff_id, 'recording_sync', 'Please sync a call recording',
          concat_ws(' · ', v_lead, to_char(private.ist(v_rec.recorded_at), 'DD/MM/YYYY HH12:MI AM')),
          jsonb_build_object('recording_id', v_rec.id),
          'recording_sync:' || v_rec.id || ':' || to_char(private.ist(now()), 'YYYY-MM-DD'))
  on conflict (dedupe_key) do nothing;
  return to_jsonb(v_rec);
end;
$$;

-- Recordings list (web): newest first, keyset. filters: staff_id, status, kind, lead_id, from, to (IST dates).
create function public.recordings_list(p_filters jsonb default '{}', p_cursor text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]);
  v_role public.staff_role := private.my_role();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_at timestamptz := 'infinity';
  v_id uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_rows jsonb;
begin
  if p_cursor is not null then
    begin
      v_at := split_part(p_cursor, '|', 1)::timestamptz;
      v_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      perform private.fail('invalid_input', 'cursor');
    end;
  end if;
  select coalesce(jsonb_agg(x.j order by x.recorded_at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select r.recorded_at, r.id, jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'status', r.status, 'recorded_at', r.recorded_at, 'duration_s', r.duration_s,
      'uploaded_s', r.uploaded_s, 'trimmed', r.trimmed, 'needs_review', r.needs_review,
      'match_confidence', r.match_confidence, 'sync_requested_at', r.sync_requested_at, 'file_id', r.file_id,
      'error', r.error, 'staff_id', r.staff_id, 'staff_name', s.full_name,
      'lead_id', r.lead_id, 'lead_name', l.name, 'sl_no', l.sl_no, 'patient_id', r.patient_id,
      'phone_e164', c.phone_e164, 'direction', c.direction, 'outcome', c.outcome, 'notes', c.notes) as j
    from public.recordings r
    join public.staff s on s.id = r.staff_id
    left join public.leads l on l.id = r.lead_id
    left join public.call_logs c on c.id = r.call_log_id
    where (r.recorded_at, r.id) < (v_at, v_id)
      and (v_role = 'admin'
           or r.staff_id = v_me
           or (v_role = 'sales_manager' and r.kind in ('call', 'voice_note'))
           or (v_role = 'receptionist' and r.kind = 'call' and r.patient_id is not null and private.reception_plays_recordings()))
      and (f ->> 'staff_id' is null or r.staff_id = (f ->> 'staff_id')::uuid)
      and (f ->> 'status' is null or r.status = (f ->> 'status')::public.recording_status)
      and (f ->> 'kind' is null or r.kind = (f ->> 'kind')::public.recording_kind)
      and (f ->> 'lead_id' is null or r.lead_id = (f ->> 'lead_id')::uuid)
      and (f ->> 'patient_id' is null or r.patient_id = (f ->> 'patient_id')::uuid)
      and (f ->> 'from' is null or r.recorded_at >= private.ist_at((f ->> 'from')::date, '00:00'))
      and (f ->> 'to' is null or r.recorded_at < private.ist_at((f ->> 'to')::date + 1, '00:00'))
    order by r.recorded_at desc, r.id desc
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(t.e order by t.n) from jsonb_array_elements(v_rows) with ordinality t (e, n) where t.n <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit
                        then (v_rows -> (v_limit - 1) ->> 'recorded_at') || '|' || (v_rows -> (v_limit - 1) ->> 'id') end);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

-- Admin → Users: a person's recording upload mode (null = follow the clinic setting).
create or replace function public.admin_update_staff(
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
    recording_upload_override = case when p_patch ? 'recording_upload_override'
                                     then nullif(p_patch ->> 'recording_upload_override', '') else s.recording_upload_override end,
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

revoke execute on function private.recording_mode(uuid) from public;

alter default privileges revoke execute on functions from public;
select private.lock_down_public_functions();
