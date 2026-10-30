-- Live BDM map: each BDM's route so far today (the uploaded chunks' polylines, in order), so the
-- admin sees the roads they took, not only where they are now (owner, 30/10/2026).
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
      'staff_id', s.id, 'name', s.full_name, 'state', coalesce(l.state, 'off_duty'),
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
    where s.role = 'bdm' and s.active), '[]'::jsonb);
end;
$$;

select private.lock_down_public_functions();
