-- Start the day away from the office with the admin's OK, and a day for sales executives
-- (owner, 02/11/2026: "bdm and sales executive can request the admin to start the day in their
-- location instead of office").
--   * public.day_start_requests: one open request per person per day (pending → approved / declined;
--     approved → used when the day starts). The admin is told (bell + push); the person is told back.
--   * bdm_start_day: also sales executives; outside the office circle it goes through when today's
--     request was approved (flag started_away_approved).
--   * bdm_today / bdm_end_day: also sales executives. Travel, visits, breaks and route tracking stay BDM-only.
--   * Sales executives may upload the day-start selfie. bdm_live lists them too (with the role).
--   * The no-signal alarm is for BDMs only (a sales executive's phone sends no location).

create table public.day_start_requests (
  id uuid primary key,
  staff_id uuid not null references public.staff (id),
  work_date date not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy real,
  office_id uuid references public.offices (id) on delete set null,
  distance_m integer,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'used')),
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  decline_note text check (decline_note is null or length(decline_note) <= 500),
  day_id uuid references public.bdm_days (id),
  created_at timestamptz not null default now()
);
create unique index day_start_requests_open on public.day_start_requests (staff_id, work_date)
  where status in ('pending', 'approved');
create index day_start_requests_recent on public.day_start_requests (work_date desc, created_at desc);
alter table public.day_start_requests enable row level security;
grant select on public.day_start_requests to authenticated;
create policy day_start_requests_select on public.day_start_requests for select to authenticated
  using ((select private.has_role('admin')) or staff_id = (select private.my_staff_id()));

create function private.day_start_request_json(r public.day_start_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'staff_id', r.staff_id, 'work_date', r.work_date, 'lat', r.lat, 'lng', r.lng, 'accuracy', r.accuracy,
    'distance_m', r.distance_m, 'office', (select o.name from public.offices o where o.id = r.office_id),
    'reason', r.reason, 'status', r.status, 'decline_note', r.decline_note, 'decided_at', r.decided_at,
    'decided_by', (select s.full_name from public.staff s where s.id = r.decided_by), 'created_at', r.created_at,
    'name', (select s.full_name from public.staff s where s.id = r.staff_id),
    'role', (select s.role from public.staff s where s.id = r.staff_id));
$$;

-- p: {client_id, lat, lng, accuracy?, reason}. Asking twice the same day gives the open request back.
create function public.day_start_request(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm', 'sales_executive']::public.staff_role[]);
  v_today date := (private.ist(now()))::date;
  v_staff public.staff;
  v_office public.offices;
  v_row public.day_start_requests;
  v_lat double precision;
  v_lng double precision;
  v_reason text := btrim(coalesce(p ->> 'reason', ''));
  v_dist double precision;
begin
  v_lat := (p ->> 'lat')::double precision;
  v_lng := (p ->> 'lng')::double precision;
  if (p ->> 'client_id') is null or v_lat is null or v_lng is null then
    perform private.fail('invalid_input', 'client id and location');
  end if;
  select * into v_row from public.day_start_requests where id = (p ->> 'client_id')::uuid;
  if found then
    if v_row.staff_id <> v_me then
      perform private.fail('not_allowed');
    end if;
    return private.day_start_request_json(v_row) || jsonb_build_object('repeat', true);
  end if;
  if length(v_reason) = 0 or length(v_reason) > 500 then
    perform private.fail('invalid_input', 'reason');
  end if;
  if exists (select 1 from public.bdm_days d where d.staff_id = v_me and d.work_date = v_today) then
    perform private.fail('day_already_started');
  end if;
  select * into v_row from public.day_start_requests r
   where r.staff_id = v_me and r.work_date = v_today and r.status in ('pending', 'approved');
  if found then
    return private.day_start_request_json(v_row) || jsonb_build_object('repeat', true);
  end if;
  select * into v_staff from public.staff where id = v_me;
  select * into v_office from public.offices o where o.id = v_staff.office_id and o.active;
  if not found then
    select * into v_office from public.offices o where o.active
     order by private.geo_distance_m(o.lat, o.lng, v_lat, v_lng) limit 1;
  end if;
  if v_office.id is not null then
    v_dist := private.geo_distance_m(v_office.lat, v_office.lng, v_lat, v_lng);
  end if;
  insert into public.day_start_requests (id, staff_id, work_date, lat, lng, accuracy, office_id, distance_m, reason)
  values ((p ->> 'client_id')::uuid, v_me, v_today, v_lat, v_lng, (p ->> 'accuracy')::real, v_office.id, round(v_dist)::int, v_reason)
  returning * into v_row;
  perform private.notify_admins('day_start_request', v_staff.full_name || ' asks to start the day away from the office',
    v_reason || case when v_dist is not null then ' · ' || case when v_dist >= 1000 then to_char(v_dist / 1000, 'FM999990.0') || ' km'
                                                               else round(v_dist)::text || ' m' end
                                               || ' from ' || v_office.name else '' end,
    '/bdm', 'day_start:' || v_row.id);
  return private.day_start_request_json(v_row) || jsonb_build_object('repeat', false);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    perform private.fail('invalid_input');
end;
$$;

-- The admin answers. A "no" needs a note; it's sent back to the person.
create function public.day_start_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['admin']::public.staff_role[]);
  v_row public.day_start_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_approve is null then
    perform private.fail('invalid_input', 'approve');
  end if;
  select * into v_row from public.day_start_requests where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_row.status <> 'pending' then
    if (p_approve and v_row.status in ('approved', 'used')) or (not p_approve and v_row.status = 'declined') then
      return private.day_start_request_json(v_row) || jsonb_build_object('repeat', true);
    end if;
    perform private.fail('invalid_status_change', v_row.status);
  end if;
  if not p_approve and (v_note is null or length(v_note) > 500) then
    perform private.fail('invalid_input', 'note');
  end if;
  if v_row.work_date <> (private.ist(now()))::date and p_approve then
    perform private.fail('invalid_status_change', 'not today');
  end if;
  update public.day_start_requests set
    status = case when p_approve then 'approved' else 'declined' end,
    decided_by = v_me, decided_at = now(), decline_note = case when p_approve then null else v_note end
  where id = p_id
  returning * into v_row;
  insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
  values (v_row.staff_id, 'day_start_decision',
          case when p_approve then 'You can start the day where you are' else 'Start the day at the office' end,
          case when p_approve then 'The admin allowed it. Open the app and press Start day.' else v_note end,
          null, 'day_start_decided:' || v_row.id)
  on conflict (dedupe_key) do nothing;
  return private.day_start_request_json(v_row) || jsonb_build_object('repeat', false);
end;
$$;

-- Admin: today's waiting requests first, then the last 7 days.
create function public.day_start_requests_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(private.day_start_request_json(r)
                     order by (r.status = 'pending' and r.work_date = (private.ist(now()))::date) desc, r.created_at desc)
    from (select * from public.day_start_requests r
          where r.work_date >= (private.ist(now()))::date - 7
          order by r.created_at desc limit 100) r), '[]'::jsonb);
end;
$$;

-- Sales executives may upload the day-start selfie.
-- Upload rules per purpose: who may upload, allowed types, size cap (PLAN.md 14.1).
create or replace function private.file_rule(p_purpose public.file_purpose)
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
    ('selfie',            array['bdm','sales_executive','admin']::public.staff_role[], array['image/webp','image/jpeg'], 512000),
    ('doctor_signature',  array['admin']::public.staff_role[], array['image/png','image/webp'], 307200),
    ('pdf',               array['receptionist','admin']::public.staff_role[], array['application/pdf'], 5242880),
    ('thumbnail',         array['receptionist','sales_executive','sales_manager','bdm','admin']::public.staff_role[], array['image/webp','image/jpeg'], 102400)
  ) as r (purpose, roles, mimes, max_bytes)
  where r.purpose = p_purpose;
$$;


-- Away from the office with an approved request; sales executives too.
create or replace function public.bdm_start_day(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm', 'sales_executive']::public.staff_role[]);
  v_staff public.staff;
  v_day public.bdm_days;
  v_office public.offices;
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_dist double precision;
  v_inside boolean;
  v_flags text[] := '{}';
  v_selfie uuid := nullif(p ->> 'selfie_file_id', '')::uuid;
  v_req public.day_start_requests;
begin
  select * into v_day from public.bdm_days where staff_id = v_me and work_date = (private.ist(now()))::date;
  if found then
    return jsonb_build_object('day', to_jsonb(v_day), 'inside', v_day.start_in_geofence, 'distance_m', v_day.start_distance_m, 'repeat', true);
  end if;
  if (p ->> 'client_id') is null or v_lat is null or v_lng is null then
    perform private.fail('invalid_input', 'client id and location');
  end if;
  select * into v_staff from public.staff where id = v_me;
  if coalesce((private.bdm_setting('require_selfie', 'true') #>> '{}')::boolean, true) then
    if v_selfie is null or not exists (
      select 1 from public.files f where f.id = v_selfie and f.owner_staff_id = v_me and f.purpose = 'selfie' and f.status = 'uploaded') then
      perform private.fail('selfie_required');
    end if;
  end if;
  -- Their office, else the nearest active one.
  select * into v_office from public.offices o where o.id = v_staff.office_id and o.active;
  if not found then
    select * into v_office from public.offices o where o.active
     order by private.geo_distance_m(o.lat, o.lng, v_lat, v_lng) limit 1;
  end if;
  if v_office.id is not null then
    v_dist := private.geo_distance_m(v_office.lat, v_office.lng, v_lat, v_lng);
    v_inside := v_dist <= v_office.radius_m;
  end if;
  -- Away from the office: only with "start anywhere", or today's request the admin approved.
  if not coalesce(v_inside, false) and not v_staff.bdm_start_anywhere then
    select * into v_req from public.day_start_requests r
     where r.staff_id = v_me and r.work_date = (private.ist(now()))::date and r.status = 'approved'
     for update;
  end if;
  if not coalesce(v_inside, false) and not v_staff.bdm_start_anywhere and v_req.id is null then
    perform private.fail('outside_office', format('%s m from %s', round(coalesce(v_dist, -1)), coalesce(v_office.name, 'no office set up')));
  end if;
  if not coalesce(v_inside, false) then
    v_flags := array_append(v_flags, 'started_away');
  end if;
  if v_req.id is not null then
    v_flags := array_append(v_flags, 'started_away_approved');
  end if;
  if coalesce((p ->> 'is_mock')::boolean, false) then
    v_flags := array_append(v_flags, 'mock_location');
  end if;
  if (private.ist(now()))::time > (private.bdm_setting('late_start_time', '"10:30"') #>> '{}')::time then
    v_flags := array_append(v_flags, 'late_start');
  end if;

  insert into public.bdm_days (id, staff_id, work_date, start_lat, start_lng, start_accuracy, selfie_file_id,
                               start_in_geofence, start_distance_m, office_id, flags)
  values ((p ->> 'client_id')::uuid, v_me, (private.ist(now()))::date, v_lat, v_lng, (p ->> 'accuracy')::real, v_selfie,
          v_inside, round(v_dist)::int, v_office.id, v_flags)
  returning * into v_day;
  perform private.bdm_log(v_day, 'start_day', p);
  if v_req.id is not null then
    update public.day_start_requests set status = 'used', day_id = v_day.id where id = v_req.id;
  end if;
  if 'mock_location' = any (v_flags) then
    perform private.bdm_log(v_day, 'mock_location', p);
    perform private.notify_admins('bdm_alert', v_staff.full_name || ': fake location at day start', null, '/bdm', 'bdm_mock:' || v_day.id);
  end if;
  perform private.bdm_set_state(v_day, 'in_office');
  return jsonb_build_object('day', to_jsonb(v_day), 'inside', v_inside, 'distance_m', round(v_dist)::int,
                            'office', case when v_office.id is not null then to_jsonb(v_office) end, 'repeat', false);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;


-- Today's request (if any) for the phone; sales executives too.
create or replace function public.bdm_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm', 'sales_executive']::public.staff_role[]);
  v_day public.bdm_days;
begin
  select * into v_day from public.bdm_days where staff_id = v_me and work_date = (private.ist(now()))::date;
  return jsonb_build_object(
    'day', case when v_day.id is not null then to_jsonb(v_day) end,
    'visit', (select to_jsonb(v) from public.site_visits v where v.day_id = v_day.id and v.completed_at is null
              order by v.travel_started_at desc limit 1),
    'break', (select to_jsonb(b) from public.bdm_breaks b where b.day_id = v_day.id and b.ended_at is null),
    'last_seq', (select max(c.seq) from public.location_chunks c where c.day_id = v_day.id),
    'summary', case when v_day.id is not null then private.bdm_day_summary(v_day.id) end,
    'start_request', (select private.day_start_request_json(r) from public.day_start_requests r
                      where r.staff_id = v_me and r.work_date = (private.ist(now()))::date
                      order by r.created_at desc limit 1),
    'settings', jsonb_build_object(
      'heartbeat_minutes', private.bdm_setting('heartbeat_minutes', '5'),
      'upload_minutes', private.bdm_setting('upload_minutes', '5'),
      'require_selfie', private.bdm_setting('require_selfie', 'true')));
end;
$$;


-- A sales executive ends the day too.
create or replace function public.bdm_end_day(p jsonb default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm', 'sales_executive']::public.staff_role[]);
  v_day public.bdm_days;
begin
  select * into v_day from public.bdm_days where staff_id = v_me and work_date = (private.ist(now()))::date for update;
  if not found then
    perform private.fail('day_not_started');
  end if;
  if v_day.ended_at is not null then
    return to_jsonb(v_day) || jsonb_build_object('repeat', true);
  end if;
  v_day := private.bdm_finish_day(v_day, coalesce(p, '{}'::jsonb), false);
  return to_jsonb(v_day) || jsonb_build_object('repeat', false);
end;
$$;

-- The no-signal alarm: BDMs only.
create or replace function public.bdm_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quiet int := coalesce((private.bdm_setting('no_heartbeat_alert_minutes', '15') #>> '{}')::int, 15);
  v_grace int := coalesce((private.bdm_setting('break_grace_minutes', '5') #>> '{}')::int, 5);
  v_late time := coalesce((private.bdm_setting('late_start_time', '"10:30"') #>> '{}')::time, '10:30');
  v_end time := coalesce((private.bdm_setting('auto_end_time', '"21:00"') #>> '{}')::time, '21:00');
  v_today date := (private.ist(now()))::date;
  v_now_t time := (private.ist(now()))::time;
  v_working int[] := coalesce(array(select x::int from jsonb_array_elements_text(
                       private.setting('appointments', 'working_days', '[1,2,3,4,5,6]')) x), '{1,2,3,4,5,6}');
  r record;
  v_d public.bdm_days;
  v_silent int := 0;
  v_breaks int := 0;
  v_late_n int := 0;
  v_ended int := 0;
begin
  -- No heartbeat for X minutes on an open day: one alert per silence.
  for r in
    select d.*, s.full_name, coalesce(l.last_heartbeat_at, d.started_at) as last_seen
    from public.bdm_days d join public.staff s on s.id = d.staff_id
    left join public.bdm_live_status l on l.staff_id = d.staff_id
    where d.ended_at is null and d.work_date = v_today and s.role = 'bdm'
      and coalesce(l.last_heartbeat_at, d.started_at) < now() - make_interval(mins => v_quiet)
  loop
    if not exists (select 1 from public.bdm_events e where e.day_id = r.id and e.kind = 'no_heartbeat'
                   and e.data ->> 'since' = r.last_seen::text) then
      insert into public.bdm_events (id, day_id, staff_id, kind, data)
      values (gen_random_uuid(), r.id, r.staff_id, 'no_heartbeat', jsonb_build_object('since', r.last_seen::text));
      update public.bdm_days set flags = array_append(flags, 'no_heartbeat') where id = r.id and not ('no_heartbeat' = any (flags));
      perform private.notify_admins('bdm_alert', r.full_name || ': no signal from the phone since '
                                    || to_char(private.ist(r.last_seen), 'HH12:MI AM'), null, '/bdm',
                                    'bdm_silent:' || r.staff_id || ':' || r.last_seen::text);
      v_silent := v_silent + 1;
    end if;
  end loop;

  -- Break longer than planned (+ grace): one alert per break.
  for r in
    update public.bdm_breaks b set overrun_alerted = true
    from public.staff s
    where s.id = b.staff_id and b.ended_at is null and not b.overrun_alerted
      and b.started_at + make_interval(mins => b.planned_minutes + v_grace) < now()
    returning b.*, s.full_name
  loop
    perform private.notify_admins('bdm_alert', r.full_name || ': break over its ' || r.planned_minutes || ' minutes', null, '/bdm',
                                  'bdm_break:' || r.id);
    v_breaks := v_breaks + 1;
  end loop;

  -- Not started by the late-start time on a working day: one alert per BDM per day.
  if v_now_t > v_late and extract(isodow from v_today)::int = any (v_working)
     and not exists (select 1 from public.holidays h where h.day = v_today) then
    for r in
      select s.* from public.staff s
      where s.role = 'bdm' and s.active
        and not exists (select 1 from public.bdm_days d where d.staff_id = s.id and d.work_date = v_today)
    loop
      perform private.notify_admins('bdm_alert', r.full_name || ' has not started the day', null, '/bdm',
                                    'bdm_late:' || r.id || ':' || v_today);
      v_late_n := v_late_n + 1;
    end loop;
  end if;

  -- Days left open: after the auto-end time, or from an earlier date.
  for v_d in
    select * from public.bdm_days d
    where d.ended_at is null and (d.work_date < v_today or v_now_t >= v_end)
    for update skip locked
  loop
    perform private.bdm_finish_day(v_d, '{}'::jsonb, true);
    v_ended := v_ended + 1;
  end loop;

  return jsonb_build_object('silent', v_silent, 'breaks', v_breaks, 'late', v_late_n, 'auto_ended', v_ended);
end;
$$;


-- The admin's live list: sales executives too, with the role.
create or replace function public.bdm_live()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'staff_id', s.id, 'name', s.full_name, 'role', s.role, 'state', coalesce(l.state, 'off_duty'),
      'lat', l.lat, 'lng', l.lng, 'accuracy', l.accuracy, 'battery', l.battery, 'charging', l.charging,
      'gps_on', l.gps_on, 'network', l.network, 'app_version', l.app_version, 'last_heartbeat_at', l.last_heartbeat_at,
      'locate_requested_at', l.locate_requested_at,
      'day', (select jsonb_build_object('id', d.id, 'started_at', d.started_at, 'ended_at', d.ended_at, 'flags', d.flags,
                                        'start_in_geofence', d.start_in_geofence,
                                        'route', (select coalesce(jsonb_agg(c.polyline order by c.seq), '[]'::jsonb)
                                                  from public.location_chunks c where c.day_id = d.id))
              from public.bdm_days d where d.staff_id = s.id and d.work_date = (private.ist(now()))::date))
    order by s.full_name)
    from public.staff s left join public.bdm_live_status l on l.staff_id = s.id
    where s.role in ('bdm', 'sales_executive') and s.active), '[]'::jsonb);
end;
$$;

select private.lock_down_public_functions();
