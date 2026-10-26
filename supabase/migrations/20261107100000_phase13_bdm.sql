-- Phase 13: BDM field app and admin views (PLAN.md C2 "BDM", D1 BDM RPCs, E3 row 13).
-- Days start inside an office geofence (unless allowed anywhere), every action is an event with
-- server time, the GPS track arrives in small idempotent chunks, a heartbeat feeds the live
-- map, and a 5-minute watchdog raises alerts once. Route estimates (OpenRouteService) are
-- queued and retried by the route-estimate Edge Function.

create type public.bdm_state as enum ('off_duty', 'in_office', 'travelling', 'at_visit', 'on_break');
create type public.bdm_event_kind as enum (
  'start_day', 'office', 'travel_start', 'reached', 'visit_complete', 'break_start', 'break_end', 'end_day',
  'gps_off', 'gps_on', 'permission_lost', 'battery_saver', 'mock_location', 'no_heartbeat', 'auto_end'
);
create type public.estimate_status as enum ('pending', 'ok', 'failed');

------------------------------------------------------------------------------
-- Geo maths (golden vectors: packages/shared/test-vectors/geo.json)
------------------------------------------------------------------------------
create function private.geo_distance_m(p_lat1 double precision, p_lng1 double precision,
                                       p_lat2 double precision, p_lng2 double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2))));
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
create table public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null default 200 check (radius_m between 25 and 5000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger offices_touch before update on public.offices for each row execute function private.touch_updated();
alter table public.staff add constraint staff_office_fk foreign key (office_id) references public.offices (id) on delete set null;

create table public.bdm_days (
  id uuid primary key,
  staff_id uuid not null references public.staff (id),
  work_date date not null,
  started_at timestamptz not null default now(),
  start_lat double precision,
  start_lng double precision,
  start_accuracy real,
  selfie_file_id uuid references public.files (id),
  start_in_geofence boolean,
  start_distance_m integer,
  office_id uuid references public.offices (id),
  state public.bdm_state not null default 'in_office',
  ended_at timestamptz,
  end_lat double precision,
  end_lng double precision,
  auto_ended boolean not null default false,
  flags text[] not null default '{}',
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (staff_id, work_date)
);
create index bdm_days_open on public.bdm_days (work_date) where ended_at is null;
create trigger bdm_days_touch before update on public.bdm_days for each row execute function private.touch_updated();

create table public.site_visits (
  id uuid primary key,
  day_id uuid not null references public.bdm_days (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  destination text not null check (length(btrim(destination)) between 1 and 200),
  purpose text check (length(purpose) <= 500),
  dest_lat double precision,
  dest_lng double precision,
  travel_started_at timestamptz not null,
  start_lat double precision,
  start_lng double precision,
  reached_at timestamptz,
  reached_lat double precision,
  reached_lng double precision,
  reached_accuracy real,
  punch_photo_file_id uuid references public.files (id),
  recording_id uuid references public.recordings (id) on delete set null,
  completed_at timestamptz,
  outcome text check (length(outcome) <= 2000),
  contact_name text check (length(contact_name) <= 120),
  contact_phone text check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  contact_designation text check (length(contact_designation) <= 120),
  interest text check (interest in ('hot', 'warm', 'cold', 'none')),
  lead_id uuid references public.leads (id) on delete set null,
  actual_m integer,
  est_distance_m integer,
  est_minutes integer,
  estimate_status public.estimate_status not null default 'pending',
  estimate_attempts integer not null default 0,
  estimate_next_at timestamptz,
  estimate_error text check (length(estimate_error) <= 500),
  flag_long_route boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index site_visits_day on public.site_visits (day_id, travel_started_at);
create index site_visits_estimate on public.site_visits (estimate_next_at) where estimate_status = 'pending' and reached_at is not null;
create trigger site_visits_touch before update on public.site_visits for each row execute function private.touch_updated();
alter table public.recordings add constraint recordings_site_visit_fk
  foreign key (site_visit_id) references public.site_visits (id) on delete set null;

create table public.bdm_events (
  id uuid primary key,
  day_id uuid not null references public.bdm_days (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  kind public.bdm_event_kind not null,
  device_at timestamptz,
  server_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  accuracy real,
  site_visit_id uuid references public.site_visits (id) on delete set null,
  data jsonb not null default '{}'
);
create index bdm_events_day on public.bdm_events (day_id, server_at);

create table public.bdm_breaks (
  id uuid primary key,
  day_id uuid not null references public.bdm_days (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  type_id uuid references public.lookup_values (id),
  planned_minutes integer not null check (planned_minutes between 5 and 180),
  resume_state public.bdm_state not null default 'in_office',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  overrun_alerted boolean not null default false
);
create unique index bdm_breaks_one_open on public.bdm_breaks (day_id) where ended_at is null;

create table public.location_chunks (
  id uuid primary key,
  day_id uuid not null references public.bdm_days (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  seq integer not null check (seq >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  points integer not null check (points between 1 and 2000),
  polyline text not null check (length(polyline) <= 40000),
  offsets int2[] not null,
  accuracies int2[] not null,
  distance_m integer not null default 0 check (distance_m between 0 and 500000),
  flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (day_id, seq),
  check (ended_at >= started_at),
  check (cardinality(offsets) = points and cardinality(accuracies) = points)
);
create index location_chunks_time on public.location_chunks (day_id, started_at);

create table public.bdm_live_status (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  day_id uuid references public.bdm_days (id) on delete set null,
  state public.bdm_state not null default 'off_duty',
  lat double precision,
  lng double precision,
  accuracy real,
  battery smallint check (battery between 0 and 100),
  charging boolean,
  gps_on boolean,
  network text check (length(network) <= 20),
  app_version text check (length(app_version) <= 40),
  last_heartbeat_at timestamptz,
  locate_requested_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.bdm_days (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  site_visit_id uuid references public.site_visits (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  polylines text[] not null default '{}',
  distance_m integer not null default 0,
  stops integer not null default 0,
  gaps jsonb not null default '[]'
);
create index trips_day on public.trips (day_id, started_at);

------------------------------------------------------------------------------
-- Who sees what: a BDM their own field data, the admin everything (PLAN.md C7).
------------------------------------------------------------------------------
alter table public.offices enable row level security;
alter table public.bdm_days enable row level security;
alter table public.site_visits enable row level security;
alter table public.bdm_events enable row level security;
alter table public.bdm_breaks enable row level security;
alter table public.location_chunks enable row level security;
alter table public.bdm_live_status enable row level security;
alter table public.trips enable row level security;

grant select on public.offices, public.bdm_days, public.site_visits, public.bdm_events, public.bdm_breaks,
  public.location_chunks, public.bdm_live_status, public.trips to authenticated;
-- Offices are simple admin master data, written directly (like doctors).
grant insert, update on public.offices to authenticated;

create policy offices_select on public.offices for select to authenticated using (true);
create policy offices_insert on public.offices for insert to authenticated with check ((select private.has_role('admin')));
create policy offices_update on public.offices for update to authenticated
  using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));

create policy bdm_days_select on public.bdm_days for select to authenticated
  using ((select private.has_role('admin')) or staff_id = (select private.my_staff_id()));
create policy site_visits_select on public.site_visits for select to authenticated
  using ((select private.has_role('admin')) or staff_id = (select private.my_staff_id()));
create policy bdm_events_select on public.bdm_events for select to authenticated
  using ((select private.has_role('admin')) or staff_id = (select private.my_staff_id()));
create policy bdm_breaks_select on public.bdm_breaks for select to authenticated
  using ((select private.has_role('admin')) or staff_id = (select private.my_staff_id()));
create policy location_chunks_select on public.location_chunks for select to authenticated
  using ((select private.has_role('admin')) or staff_id = (select private.my_staff_id()));
create policy bdm_live_status_select on public.bdm_live_status for select to authenticated
  using ((select private.has_role('admin')) or staff_id = (select private.my_staff_id()));
create policy trips_select on public.trips for select to authenticated
  using ((select private.has_role('admin')) or staff_id = (select private.my_staff_id()));

-- BDM photos (selfie, punch) and visit recordings: the admin may open them.
-- (files_select already lets admins and owners see everything they need.)

alter publication supabase_realtime add table public.bdm_live_status;

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
create function private.bdm_setting(p_key text, p_default jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.setting('bdm', p_key, p_default);
$$;

-- Today's open day for the caller (fails when none).
create function private.bdm_open_day(p_staff uuid)
returns public.bdm_days
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.bdm_days;
begin
  select * into v_day from public.bdm_days
   where staff_id = p_staff and work_date = (private.ist(now()))::date
   for update;
  if not found then
    perform private.fail('day_not_started');
  end if;
  if v_day.ended_at is not null then
    perform private.fail('day_ended');
  end if;
  return v_day;
end;
$$;

create function private.bdm_log(p_day public.bdm_days, p_kind public.bdm_event_kind, p jsonb default '{}',
                                p_visit uuid default null, p_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.bdm_events (id, day_id, staff_id, kind, device_at, lat, lng, accuracy, site_visit_id, data)
  values (coalesce(p_id, gen_random_uuid()), p_day.id, p_day.staff_id, p_kind,
          nullif(p ->> 'device_at', '')::timestamptz, (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          (p ->> 'accuracy')::real, p_visit, coalesce(p -> 'data', '{}'::jsonb))
  on conflict (id) do nothing;
$$;

create function private.bdm_set_state(p_day public.bdm_days, p_state public.bdm_state)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.bdm_days set state = p_state where id = p_day.id;
  insert into public.bdm_live_status (staff_id, day_id, state, updated_at)
  values (p_day.staff_id, p_day.id, p_state, now())
  on conflict (staff_id) do update set day_id = excluded.day_id, state = excluded.state, updated_at = now();
$$;

-- Every active admin, once per [p_dedupe].
create function private.notify_admins(p_type text, p_title text, p_body text, p_link text, p_dedupe text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
  select s.id, p_type, p_title, p_body, p_link, p_dedupe || ':' || s.id
  from public.staff s where s.role = 'admin' and s.active
  on conflict (dedupe_key) do nothing;
$$;

-- Metres driven between two moments (from the uploaded chunks).
create function private.bdm_distance(p_day uuid, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.distance_m), 0)::int from public.location_chunks c
  where c.day_id = p_day and c.started_at >= p_from - interval '1 minute' and c.ended_at <= p_to + interval '1 minute';
$$;

-- Time split and totals for one day (PLAN.md B6 BDM tiles).
create function private.bdm_day_summary(p_day uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with d as (select * from public.bdm_days where id = p_day),
  v as (select * from public.site_visits where day_id = p_day),
  b as (select * from public.bdm_breaks where day_id = p_day),
  t as (
    select
      extract(epoch from (coalesce(d.ended_at, now()) - d.started_at))::int as total_s,
      coalesce((select sum(extract(epoch from (coalesce(v.reached_at, d.ended_at, now()) - v.travel_started_at))) from v, d), 0)::int as travel_s,
      coalesce((select sum(extract(epoch from (coalesce(v.completed_at, d.ended_at, now()) - v.reached_at))) from v, d where v.reached_at is not null), 0)::int as meeting_s,
      coalesce((select sum(extract(epoch from (coalesce(b.ended_at, d.ended_at, now()) - b.started_at))) from b, d), 0)::int as break_s,
      coalesce((select sum(b.planned_minutes) * 60 from b), 0)::int as break_allowed_s
    from d)
  select jsonb_build_object(
    'visits', (select count(*) from v),
    'visits_done', (select count(*) from v where v.completed_at is not null),
    'leads', (select count(*) from v where v.lead_id is not null),
    'distance_m', (select coalesce(sum(c.distance_m), 0) from public.location_chunks c where c.day_id = p_day),
    'actual_m', (select coalesce(sum(v.actual_m), 0) from v),
    'est_m', (select coalesce(sum(v.est_distance_m), 0) from v),
    'estimates_pending', (select count(*) from v where v.reached_at is not null and v.estimate_status = 'pending'),
    'travel_s', t.travel_s, 'meeting_s', t.meeting_s, 'break_s', t.break_s,
    'break_allowed_s', t.break_allowed_s,
    'office_s', greatest(t.total_s - t.travel_s - t.meeting_s - t.break_s, 0),
    'total_s', t.total_s)
  from t;
$$;

-- Trips: the track between each visit's start and arrival, with gaps (no signal / GPS off).
create function private.bdm_build_trips(p_day uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  delete from public.trips where day_id = p_day;
  for v in select * from public.site_visits where day_id = p_day and reached_at is not null loop
    insert into public.trips (day_id, staff_id, site_visit_id, started_at, ended_at, polylines, distance_m, stops, gaps)
    select p_day, v.staff_id, v.id, v.travel_started_at, v.reached_at,
           coalesce(array_agg(c.polyline order by c.seq) filter (where c.id is not null), '{}'),
           coalesce(sum(c.distance_m), 0)::int,
           0,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'from', g.prev_end, 'to', g.started_at,
                      'reason', case when exists (
                        select 1 from public.bdm_events e where e.day_id = p_day and e.kind = 'gps_off'
                          and e.server_at between g.prev_end - interval '1 minute' and g.started_at) then 'gps_off' else 'no_signal' end)
                    order by g.started_at)
             from (select cc.started_at, lag(cc.ended_at) over (order by cc.seq) as prev_end
                   from public.location_chunks cc
                   where cc.day_id = p_day and cc.started_at >= v.travel_started_at - interval '1 minute'
                     and cc.ended_at <= v.reached_at + interval '1 minute') g
             where g.prev_end is not null and g.started_at - g.prev_end > interval '3 minutes'), '[]'::jsonb)
    from public.location_chunks c
    where c.day_id = p_day and c.started_at >= v.travel_started_at - interval '1 minute' and c.ended_at <= v.reached_at + interval '1 minute';
    update public.site_visits sv set
      actual_m = private.bdm_distance(p_day, sv.travel_started_at, sv.reached_at),
      flag_long_route = sv.est_distance_m is not null and sv.est_distance_m > 0
        and private.bdm_distance(p_day, sv.travel_started_at, sv.reached_at)
            > sv.est_distance_m * (private.bdm_setting('long_route_factor', '1.5') #>> '{}')::numeric
    where sv.id = v.id;
  end loop;
end;
$$;

create function private.bdm_finish_day(p_day public.bdm_days, p jsonb, p_auto boolean)
returns public.bdm_days
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bdm_days;
begin
  update public.bdm_breaks set ended_at = now() where day_id = p_day.id and ended_at is null;
  perform private.bdm_log(p_day, case when p_auto then 'auto_end' else 'end_day' end::public.bdm_event_kind, p);
  perform private.bdm_build_trips(p_day.id);
  update public.bdm_days set
    ended_at = now(), end_lat = (p ->> 'lat')::double precision, end_lng = (p ->> 'lng')::double precision,
    auto_ended = p_auto, flags = case when p_auto then array_append(flags, 'auto_ended') else flags end,
    state = 'off_duty', summary = private.bdm_day_summary(p_day.id)
  where id = p_day.id
  returning * into v_row;
  perform private.bdm_set_state(v_row, 'off_duty');
  return v_row;
end;
$$;

------------------------------------------------------------------------------
-- The BDM's actions (phone; all idempotent by the id made on the phone)
------------------------------------------------------------------------------
-- p: {client_id, lat, lng, accuracy, selfie_file_id?, is_mock?, device_at?}
create function public.bdm_start_day(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
  v_staff public.staff;
  v_day public.bdm_days;
  v_office public.offices;
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_dist double precision;
  v_inside boolean;
  v_flags text[] := '{}';
  v_selfie uuid := nullif(p ->> 'selfie_file_id', '')::uuid;
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
  if not coalesce(v_inside, false) and not v_staff.bdm_start_anywhere then
    perform private.fail('outside_office', format('%s m from %s', round(coalesce(v_dist, -1)), coalesce(v_office.name, 'no office set up')));
  end if;
  if not coalesce(v_inside, false) then
    v_flags := array_append(v_flags, 'started_away');
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

-- What the phone needs after a restart: today's day, the open visit and break, offices, settings.
create function public.bdm_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
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
    'settings', jsonb_build_object(
      'heartbeat_minutes', private.bdm_setting('heartbeat_minutes', '5'),
      'upload_minutes', private.bdm_setting('upload_minutes', '5'),
      'require_selfie', private.bdm_setting('require_selfie', 'true')));
end;
$$;

-- Events the phone reports by itself: office, gps_off/on, permission_lost, battery_saver, mock_location.
-- p: {client_id, kind, device_at, lat, lng, accuracy, data}
create function public.bdm_event(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
  v_day public.bdm_days;
  v_kind public.bdm_event_kind := (p ->> 'kind')::public.bdm_event_kind;
  v_name text;
begin
  if v_kind not in ('office', 'gps_off', 'gps_on', 'permission_lost', 'battery_saver', 'mock_location')
     or (p ->> 'client_id') is null then
    perform private.fail('invalid_input', 'kind and client id');
  end if;
  if exists (select 1 from public.bdm_events where id = (p ->> 'client_id')::uuid) then
    return jsonb_build_object('repeat', true);
  end if;
  v_day := private.bdm_open_day(v_me);
  perform private.bdm_log(v_day, v_kind, p, null, (p ->> 'client_id')::uuid);
  if v_kind = 'office' then
    perform private.bdm_set_state(v_day, 'in_office');
  elsif v_kind in ('gps_off', 'permission_lost', 'mock_location') then
    update public.bdm_days set flags = array_append(flags, v_kind::text) where id = v_day.id and not (v_kind::text = any (flags));
    update public.bdm_live_status set gps_on = false where staff_id = v_me and v_kind <> 'mock_location';
    select full_name into v_name from public.staff where id = v_me;
    perform private.notify_admins('bdm_alert', v_name || case v_kind when 'gps_off' then ': location is switched off'
                                                                when 'permission_lost' then ': location permission removed'
                                                                else ': fake location app in use' end,
                                  null, '/bdm', 'bdm_' || v_kind || ':' || v_day.id);
  elsif v_kind = 'gps_on' then
    update public.bdm_live_status set gps_on = true where staff_id = v_me;
  end if;
  return jsonb_build_object('repeat', false);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

-- p: {client_id, destination, purpose?, dest_lat?, dest_lng?, lat, lng, device_at?}
create function public.bdm_travel_start(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
  v_day public.bdm_days;
  v_row public.site_visits;
begin
  select * into v_row from public.site_visits where id = (p ->> 'client_id')::uuid;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;
  v_day := private.bdm_open_day(v_me);
  if exists (select 1 from public.site_visits where day_id = v_day.id and completed_at is null) then
    perform private.fail('visit_open');
  end if;
  if exists (select 1 from public.bdm_breaks where day_id = v_day.id and ended_at is null) then
    perform private.fail('break_open');
  end if;
  if length(btrim(coalesce(p ->> 'destination', ''))) = 0 then
    perform private.fail('invalid_input', 'destination');
  end if;
  insert into public.site_visits (id, day_id, staff_id, destination, purpose, dest_lat, dest_lng, travel_started_at, start_lat, start_lng)
  values ((p ->> 'client_id')::uuid, v_day.id, v_me, btrim(p ->> 'destination'), nullif(btrim(p ->> 'purpose'), ''),
          (p ->> 'dest_lat')::double precision, (p ->> 'dest_lng')::double precision, now(),
          (p ->> 'lat')::double precision, (p ->> 'lng')::double precision)
  returning * into v_row;
  perform private.bdm_log(v_day, 'travel_start', p, v_row.id);
  perform private.bdm_set_state(v_day, 'travelling');
  return to_jsonb(v_row) || jsonb_build_object('repeat', false);
exception
  when invalid_text_representation or invalid_datetime_format or check_violation then
    perform private.fail('invalid_input');
end;
$$;

-- p: {visit_id, lat, lng, accuracy, photo_file_id?, device_at?}. Queues the route estimate.
create function public.bdm_reached(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
  v_row public.site_visits;
  v_day public.bdm_days;
  v_photo uuid := nullif(p ->> 'photo_file_id', '')::uuid;
begin
  select * into v_row from public.site_visits where id = (p ->> 'visit_id')::uuid and staff_id = v_me for update;
  if not found then
    perform private.fail('not_found', 'visit');
  end if;
  if v_row.reached_at is not null then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;
  if v_photo is not null and not exists (
    select 1 from public.files f where f.id = v_photo and f.owner_staff_id = v_me and f.purpose = 'punch_photo' and f.status = 'uploaded') then
    perform private.fail('not_found', 'photo');
  end if;
  v_day := private.bdm_open_day(v_me);
  update public.site_visits set reached_at = now(), reached_lat = (p ->> 'lat')::double precision,
         reached_lng = (p ->> 'lng')::double precision, reached_accuracy = (p ->> 'accuracy')::real,
         punch_photo_file_id = v_photo, estimate_status = 'pending', estimate_next_at = now()
   where id = v_row.id
  returning * into v_row;
  perform private.bdm_log(v_day, 'reached', p, v_row.id);
  perform private.bdm_set_state(v_day, 'at_visit');
  perform private.call_edge('route-estimate', '{}'::jsonb);
  return to_jsonb(v_row) || jsonb_build_object('repeat', false);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

-- The punch photo uploads when there is signal, maybe after the visit was marked reached.
create function public.bdm_attach_photo(p_visit_id uuid, p_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
  v_row public.site_visits;
begin
  if not exists (select 1 from public.files f where f.id = p_file_id and f.owner_staff_id = v_me
                 and f.purpose = 'punch_photo' and f.status = 'uploaded') then
    perform private.fail('not_found', 'photo');
  end if;
  update public.site_visits set punch_photo_file_id = p_file_id
   where id = p_visit_id and staff_id = v_me
  returning * into v_row;
  if v_row.id is null then
    perform private.fail('not_found', 'visit');
  end if;
  update public.files set linked_table = 'site_visits', linked_id = p_visit_id where id = p_file_id;
  return to_jsonb(v_row);
end;
$$;

-- p: {visit_id, outcome, contact_name?, contact_phone?, contact_designation?, interest?, recording_id?,
--     create_lead?: {name, phone, treatment_text?}}
create function public.bdm_visit_complete(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
  v_row public.site_visits;
  v_day public.bdm_days;
  v_lead jsonb;
  v_lead_id uuid;
begin
  select * into v_row from public.site_visits where id = (p ->> 'visit_id')::uuid and staff_id = v_me for update;
  if not found then
    perform private.fail('not_found', 'visit');
  end if;
  if v_row.completed_at is not null then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;
  if v_row.reached_at is null then
    perform private.fail('invalid_status_change', 'not reached yet');
  end if;
  v_day := private.bdm_open_day(v_me);
  if jsonb_typeof(p -> 'create_lead') = 'object' then
    -- The visit's id doubles as the new lead's client id: a retry never makes two leads.
    v_lead := public.create_lead(
      (p -> 'create_lead') || jsonb_build_object('force', true, 'via', 'android',
        'comments1', coalesce(p -> 'create_lead' ->> 'comments1', 'BDM visit: ' || v_row.destination)),
      v_row.id);
    v_lead_id := (v_lead -> 'lead' ->> 'id')::uuid;
  end if;
  update public.site_visits set completed_at = now(), outcome = nullif(btrim(p ->> 'outcome'), ''),
         contact_name = nullif(btrim(p ->> 'contact_name'), ''), contact_phone = nullif(p ->> 'contact_phone', ''),
         contact_designation = nullif(btrim(p ->> 'contact_designation'), ''), interest = nullif(p ->> 'interest', ''),
         recording_id = coalesce(nullif(p ->> 'recording_id', '')::uuid, recording_id), lead_id = coalesce(v_lead_id, lead_id)
   where id = v_row.id
  returning * into v_row;
  if v_row.recording_id is not null then
    update public.recordings set site_visit_id = v_row.id, lead_id = coalesce(lead_id, v_lead_id)
     where id = v_row.recording_id and staff_id = v_me;
  end if;
  perform private.bdm_log(v_day, 'visit_complete', p - 'create_lead', v_row.id);
  perform private.bdm_set_state(v_day, 'travelling');
  return to_jsonb(v_row) || jsonb_build_object('repeat', false);
exception
  when invalid_text_representation or invalid_datetime_format or check_violation then
    perform private.fail('invalid_input');
end;
$$;

-- p: {client_id, action: start|end, type_id?, planned_minutes?, device_at?}
create function public.bdm_break(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
  v_day public.bdm_days;
  v_row public.bdm_breaks;
begin
  v_day := private.bdm_open_day(v_me);
  if p ->> 'action' = 'start' then
    select * into v_row from public.bdm_breaks where id = (p ->> 'client_id')::uuid;
    if found then
      return to_jsonb(v_row);
    end if;
    if exists (select 1 from public.bdm_breaks where day_id = v_day.id and ended_at is null) then
      perform private.fail('break_open');
    end if;
    insert into public.bdm_breaks (id, day_id, staff_id, type_id, planned_minutes, resume_state)
    values ((p ->> 'client_id')::uuid, v_day.id, v_me, nullif(p ->> 'type_id', '')::uuid,
            least(greatest(coalesce((p ->> 'planned_minutes')::int, 30), 5), 180),
            case when v_day.state = 'on_break' then 'in_office' else v_day.state end)
    returning * into v_row;
    perform private.bdm_log(v_day, 'break_start', p);
    perform private.bdm_set_state(v_day, 'on_break');
  elsif p ->> 'action' = 'end' then
    update public.bdm_breaks set ended_at = now() where day_id = v_day.id and ended_at is null returning * into v_row;
    if v_row.id is null then
      -- Already ended (a retry): the last break.
      select * into v_row from public.bdm_breaks where day_id = v_day.id order by started_at desc limit 1;
      return coalesce(to_jsonb(v_row), '{}'::jsonb);
    end if;
    perform private.bdm_log(v_day, 'break_end', p);
    perform private.bdm_set_state(v_day, v_row.resume_state);
  else
    perform private.fail('invalid_input', 'action');
  end if;
  return to_jsonb(v_row);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

-- p: {lat, lng, device_at?}
create function public.bdm_end_day(p jsonb default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
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

-- p: {lat, lng, accuracy, battery, charging, gps_on, network, app_version}
-- → what the phone should do now (send its location at once, new settings).
create function public.bdm_heartbeat(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
  v_prev public.bdm_live_status;
  v_day public.bdm_days;
begin
  select * into v_prev from public.bdm_live_status where staff_id = v_me for update;
  select * into v_day from public.bdm_days where staff_id = v_me and work_date = (private.ist(now()))::date;
  insert into public.bdm_live_status (staff_id, day_id, state, lat, lng, accuracy, battery, charging, gps_on, network,
                                      app_version, last_heartbeat_at, updated_at)
  values (v_me, v_day.id, coalesce(v_day.state, 'off_duty'), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          (p ->> 'accuracy')::real, (p ->> 'battery')::smallint, (p ->> 'charging')::boolean, (p ->> 'gps_on')::boolean,
          left(p ->> 'network', 20), left(p ->> 'app_version', 40), now(), now())
  on conflict (staff_id) do update set
    day_id = excluded.day_id, state = excluded.state,
    lat = coalesce(excluded.lat, bdm_live_status.lat), lng = coalesce(excluded.lng, bdm_live_status.lng),
    accuracy = coalesce(excluded.accuracy, bdm_live_status.accuracy), battery = excluded.battery,
    charging = excluded.charging, gps_on = excluded.gps_on, network = excluded.network,
    app_version = excluded.app_version, last_heartbeat_at = now(), locate_requested_at = null, updated_at = now();
  return jsonb_build_object(
    'locate_now', v_prev.locate_requested_at is not null and (p ->> 'lat') is null,
    'heartbeat_minutes', private.bdm_setting('heartbeat_minutes', '5'),
    'upload_minutes', private.bdm_setting('upload_minutes', '5'),
    'day_open', v_day.id is not null and v_day.ended_at is null);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    perform private.fail('invalid_input');
end;
$$;

-- chunks: [{id, day_id, seq, started_at, ended_at, polyline, offsets[], accuracies[], distance_m, flags?}]
-- → {accepted: [ids now on the server]} (sending the same chunk again is fine).
create function public.bdm_upload_chunks(p_chunks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm']::public.staff_role[]);
begin
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) > 50 then
    perform private.fail('invalid_input', 'at most 50 chunks');
  end if;
  insert into public.location_chunks (id, day_id, staff_id, seq, started_at, ended_at, points, polyline, offsets, accuracies,
                                      distance_m, flags)
  select (c ->> 'id')::uuid, d.id, v_me, (c ->> 'seq')::int, (c ->> 'started_at')::timestamptz, (c ->> 'ended_at')::timestamptz,
         jsonb_array_length(c -> 'offsets'), c ->> 'polyline',
         array(select x::int2 from jsonb_array_elements_text(c -> 'offsets') x),
         array(select x::int2 from jsonb_array_elements_text(c -> 'accuracies') x),
         least(greatest(coalesce((c ->> 'distance_m')::int, 0), 0), 500000),
         coalesce(array(select x from jsonb_array_elements_text(c -> 'flags') x), '{}')
  from jsonb_array_elements(p_chunks) c
  join public.bdm_days d on d.id = (c ->> 'day_id')::uuid and d.staff_id = v_me
  on conflict do nothing;
  return jsonb_build_object('accepted', coalesce((
    select jsonb_agg(lc.id) from public.location_chunks lc
    where lc.staff_id = v_me and lc.id in (select (c ->> 'id')::uuid from jsonb_array_elements(p_chunks) c)), '[]'::jsonb));
exception
  when invalid_text_representation or invalid_datetime_format or check_violation or not_null_violation then
    perform private.fail('invalid_input');
end;
$$;

------------------------------------------------------------------------------
-- Admin views
------------------------------------------------------------------------------
create function public.bdm_live()
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
      'staff_id', s.id, 'name', s.full_name, 'state', coalesce(l.state, 'off_duty'),
      'lat', l.lat, 'lng', l.lng, 'accuracy', l.accuracy, 'battery', l.battery, 'charging', l.charging,
      'gps_on', l.gps_on, 'network', l.network, 'app_version', l.app_version, 'last_heartbeat_at', l.last_heartbeat_at,
      'locate_requested_at', l.locate_requested_at,
      'day', (select jsonb_build_object('id', d.id, 'started_at', d.started_at, 'ended_at', d.ended_at, 'flags', d.flags,
                                        'start_in_geofence', d.start_in_geofence)
              from public.bdm_days d where d.staff_id = s.id and d.work_date = (private.ist(now()))::date))
    order by s.full_name)
    from public.staff s left join public.bdm_live_status l on l.staff_id = s.id
    where s.role = 'bdm' and s.active), '[]'::jsonb);
end;
$$;

-- "Locate now": the phone sends its position at its next heartbeat (a push wakes it).
create function public.bdm_locate_now(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  insert into public.bdm_live_status (staff_id, locate_requested_at) values (p_staff_id, now())
  on conflict (staff_id) do update set locate_requested_at = now();
  insert into public.notifications (recipient_id, type, title, dedupe_key)
  values (p_staff_id, 'locate_now', 'Please share your location', 'locate_now:' || p_staff_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'))
  on conflict (dedupe_key) do nothing;
end;
$$;

-- One BDM's day like the paper sheet: events, visits (km actual vs estimated), breaks, the
-- route (chunks for playback), trips, photos, recordings, flags and the summary.
create function public.bdm_day_timeline(p_staff_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm', 'admin']::public.staff_role[]);
  v_day public.bdm_days;
begin
  if not private.has_role('admin') and p_staff_id <> v_me then
    perform private.fail('not_allowed');
  end if;
  select * into v_day from public.bdm_days where staff_id = p_staff_id and work_date = p_date;
  if not found then
    return jsonb_build_object('day', null, 'staff', (select jsonb_build_object('id', s.id, 'name', s.full_name) from public.staff s where s.id = p_staff_id));
  end if;
  return jsonb_build_object(
    'staff', (select jsonb_build_object('id', s.id, 'name', s.full_name) from public.staff s where s.id = p_staff_id),
    'day', to_jsonb(v_day) || jsonb_build_object('office', (select o.name from public.offices o where o.id = v_day.office_id)),
    'summary', coalesce(v_day.summary, private.bdm_day_summary(v_day.id)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'at', e.server_at, 'lat', e.lat, 'lng', e.lng,
                                                            'visit_id', e.site_visit_id, 'data', e.data) order by e.server_at)
                        from public.bdm_events e where e.day_id = v_day.id), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object(
                          'lead', (select jsonb_build_object('id', l.id, 'name', l.name, 'sl_no', l.sl_no) from public.leads l where l.id = v.lead_id),
                          'recording_file_id', (select r.file_id from public.recordings r where r.id = v.recording_id))
                        order by v.travel_started_at) from public.site_visits v where v.day_id = v_day.id), '[]'::jsonb),
    'breaks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'type', lv.label, 'planned_minutes', b.planned_minutes,
                                                            'started_at', b.started_at, 'ended_at', b.ended_at,
                                                            'overrun', b.ended_at is not null and b.ended_at > b.started_at + make_interval(mins => b.planned_minutes))
                                         order by b.started_at)
                        from public.bdm_breaks b left join public.lookup_values lv on lv.id = b.type_id where b.day_id = v_day.id), '[]'::jsonb),
    'chunks', coalesce((select jsonb_agg(jsonb_build_object('seq', c.seq, 'started_at', c.started_at, 'ended_at', c.ended_at,
                                                            'polyline', c.polyline, 'offsets', c.offsets, 'distance_m', c.distance_m)
                                         order by c.seq) from public.location_chunks c where c.day_id = v_day.id), '[]'::jsonb),
    'trips', coalesce((select jsonb_agg(to_jsonb(t) - 'polylines' order by t.started_at) from public.trips t where t.day_id = v_day.id), '[]'::jsonb));
end;
$$;

-- Rows for the Excel export (one per BDM per day).
create function public.bdm_report(p_from date, p_to date, p_staff_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  perform private.check_range(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', d.work_date, 'name', s.full_name, 'started_at', d.started_at, 'ended_at', d.ended_at,
      'in_office_at_start', d.start_in_geofence, 'office', o.name,
      'visits', x ->> 'visits', 'leads', x ->> 'leads',
      'km_actual', round(((x ->> 'actual_m')::numeric) / 1000, 1), 'km_estimated', round(((x ->> 'est_m')::numeric) / 1000, 1),
      'km_total', round(((x ->> 'distance_m')::numeric) / 1000, 1),
      'break_minutes', round(((x ->> 'break_s')::numeric) / 60), 'break_allowed_minutes', round(((x ->> 'break_allowed_s')::numeric) / 60),
      'travel_minutes', round(((x ->> 'travel_s')::numeric) / 60), 'meeting_minutes', round(((x ->> 'meeting_s')::numeric) / 60),
      'flags', array_to_string(d.flags, ', '), 'auto_ended', d.auto_ended) order by d.work_date, s.full_name)
    from public.bdm_days d
    join public.staff s on s.id = d.staff_id
    left join public.offices o on o.id = d.office_id
    cross join lateral (select coalesce(d.summary, private.bdm_day_summary(d.id)) as x) xs
    where d.work_date between p_from and p_to and (p_staff_ids is null or d.staff_id = any (p_staff_ids))), '[]'::jsonb);
end;
$$;

-- BDM "My day" (own) or any BDM's day for the admin.
create function public.dashboard_bdm(p_date date default null, p_staff_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['bdm', 'admin']::public.staff_role[]);
  v_staff uuid := case when private.has_role('admin') then coalesce(p_staff_id, v_me) else v_me end;
  v_date date := coalesce(p_date, (private.ist(now()))::date);
  v_month date := date_trunc('month', v_date::timestamp)::date;
  v_day public.bdm_days;
begin
  select * into v_day from public.bdm_days where staff_id = v_staff and work_date = v_date;
  return jsonb_build_object(
    'date', v_date,
    'today', case when v_day.id is not null then coalesce(v_day.summary, private.bdm_day_summary(v_day.id)) end,
    'state', v_day.state, 'started_at', v_day.started_at, 'ended_at', v_day.ended_at, 'flags', v_day.flags,
    'month', (
      select jsonb_build_object(
        'days', count(distinct d.id),
        'visits', (select count(*) from public.site_visits v join public.bdm_days dd on dd.id = v.day_id
                   where dd.staff_id = v_staff and dd.work_date between v_month and v_date),
        'leads', (select count(*) from public.leads l where l.created_by = v_staff and l.deleted_at is null
                  and (private.ist(l.created_at))::date between v_month and v_date),
        'conversions', (select count(*) from public.leads l where l.created_by = v_staff and l.deleted_at is null
                        and l.stage = 'converted' and (private.ist(l.created_at))::date between v_month and v_date),
        'km', round(coalesce((select sum(c.distance_m) from public.location_chunks c join public.bdm_days dd on dd.id = c.day_id
                              where dd.staff_id = v_staff and dd.work_date between v_month and v_date), 0) / 1000.0, 1))
      from public.bdm_days d where d.staff_id = v_staff and d.work_date between v_month and v_date));
end;
$$;

------------------------------------------------------------------------------
-- Watchdog (every 5 minutes): alerts once per problem; ends forgotten days.
------------------------------------------------------------------------------
create function public.bdm_watchdog()
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
    where d.ended_at is null and d.work_date = v_today
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

------------------------------------------------------------------------------
-- Route estimates (route-estimate Edge Function, service role)
------------------------------------------------------------------------------
create function public.route_estimates_due(p_limit integer default 20)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'from', jsonb_build_array(v.start_lat, v.start_lng), 'to', jsonb_build_array(v.reached_lat, v.reached_lng))
         order by v.reached_at), '[]'::jsonb)
  from (select * from public.site_visits
        where estimate_status = 'pending' and reached_at is not null
          and start_lat is not null and reached_lat is not null
          and coalesce(estimate_next_at, now()) <= now()
        order by reached_at limit least(greatest(coalesce(p_limit, 20), 1), 50)) v;
$$;

-- ok → distance and minutes; not ok → try again later (5 tries, then "failed").
create function public.route_estimate_save(p_id uuid, p_ok boolean, p_distance_m integer default null,
                                           p_minutes integer default null, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.site_visits;
begin
  if p_ok then
    update public.site_visits set est_distance_m = p_distance_m, est_minutes = p_minutes, estimate_status = 'ok',
           estimate_error = null, estimate_next_at = null
     where id = p_id
    returning * into v_row;
    if v_row.id is not null then
      update public.site_visits set
        actual_m = private.bdm_distance(v_row.day_id, v_row.travel_started_at, v_row.reached_at),
        flag_long_route = private.bdm_distance(v_row.day_id, v_row.travel_started_at, v_row.reached_at)
                          > p_distance_m * (private.bdm_setting('long_route_factor', '1.5') #>> '{}')::numeric
       where id = p_id;
    end if;
  else
    update public.site_visits set
      estimate_attempts = estimate_attempts + 1,
      estimate_status = case when estimate_attempts + 1 >= 5 then 'failed' else 'pending' end::public.estimate_status,
      estimate_error = left(p_error, 500),
      estimate_next_at = now() + make_interval(mins => 10 * power(2, estimate_attempts)::int)
     where id = p_id;
  end if;
end;
$$;

-- Admin → Users: a BDM's office (their day-start geofence).
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
    office_id = case when p_patch ? 'office_id' then nullif(p_patch ->> 'office_id', '')::uuid else s.office_id end,
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

-- OpenRouteService health for the admin's integration list.
create function public.ors_integration_state(p_state text, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.integration_status (integration, state, last_ok_at, last_error, checked_at)
  values ('ors', p_state, case when p_state = 'ok' then now() end, left(p_error, 1000), now())
  on conflict (integration) do update set
    state = excluded.state,
    last_ok_at = coalesce(excluded.last_ok_at, public.integration_status.last_ok_at),
    last_error = excluded.last_error,
    checked_at = now();
$$;

revoke execute on function public.route_estimates_due(integer), public.route_estimate_save(uuid, boolean, integer, integer, text),
  public.bdm_watchdog(), public.ors_integration_state(text, text) from public, anon, authenticated;
grant execute on function public.route_estimates_due(integer), public.route_estimate_save(uuid, boolean, integer, integer, text),
  public.bdm_watchdog(), public.ors_integration_state(text, text) to service_role;

select cron.schedule('bdm-watchdog', '*/5 * * * *', $$select public.bdm_watchdog()$$);
select cron.schedule('route-estimate', '*/10 * * * *', $$select private.call_edge('route-estimate', '{}')$$);

alter default privileges revoke execute on functions from public;
select private.lock_down_public_functions();
