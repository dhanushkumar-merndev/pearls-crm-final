-- Sales "Bookings" list (owner 20/11/2026: "booking or appointment, where to see?").
-- The bookings of a salesperson's leads in one list, on the web and the phone:
--   upcoming = today onwards, still on (cancelled ones only when the server auto-cancelled them: they need a call)
--   confirm  = today onwards, waiting for the patient's confirmation or auto-cancelled
--   past     = the last 90 days, newest first (every outcome except "moved to another time")
-- A sales executive sees bookings of leads assigned to them or booked by them (same rule as the
-- phone's sync); a sales manager or admin sees every lead booking. Keyset pages, at most 100.

create or replace function public.sales_bookings(p_scope text default 'upcoming', p_cursor text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_all boolean := private.has_role('sales_manager') or private.has_role('admin');
  v_today date := (private.ist(now()))::date;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_c jsonb;
  v_rows jsonb;
  v_last jsonb;
begin
  if p_scope is null or p_scope not in ('upcoming', 'confirm', 'past') then
    perform private.fail('invalid_input', 'scope');
  end if;
  begin
    v_c := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
    if v_c is not null and (jsonb_typeof(v_c) <> 'array' or jsonb_array_length(v_c) <> 2) then
      raise exception 'bad cursor';
    end if;
    if v_c is not null then
      perform (v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid;
    end if;
  exception when others then
    perform private.fail('invalid_input', 'cursor');
  end;

  select coalesce(jsonb_agg(x.card order by x.ord), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'id', a.id, 'lead_id', a.lead_id, 'lead_name', l.name, 'lead_phone', l.phone_e164, 'lead_sl_no', l.sl_no,
             'patient_id', a.patient_id, 'doctor_id', a.doctor_id, 'doctor', coalesce(d.display_name, d.full_name),
             'appt_date', a.appt_date, 'slot_start', a.slot_start, 'status', a.status, 'mode', a.mode,
             'auto_cancelled', a.auto_cancelled_at is not null, 'version', a.version,
             'k', k.at) as card,
           row_number() over (order by
             case when p_scope = 'past' then null else k.at end asc,
             case when p_scope = 'past' then k.at end desc,
             case when p_scope = 'past' then null else a.id end asc,
             case when p_scope = 'past' then a.id end desc) as ord
    from public.appointments a
    join public.leads l on l.id = a.lead_id and l.deleted_at is null
    left join public.doctors d on d.id = a.doctor_id
    cross join lateral (select coalesce(a.slot_start, (a.appt_date::timestamp at time zone 'Asia/Kolkata')) as at) k
    where a.lead_id is not null
      and (v_all or l.assigned_to = v_me or a.booked_by = v_me)
      and case p_scope
            when 'upcoming' then a.appt_date >= v_today
              and a.status <> 'rescheduled' and (a.status <> 'cancelled' or a.auto_cancelled_at is not null)
            when 'confirm' then a.appt_date >= v_today
              and (a.status = 'pending_confirmation' or (a.status = 'cancelled' and a.auto_cancelled_at is not null))
            else a.appt_date < v_today and a.appt_date >= v_today - 90 and a.status <> 'rescheduled'
          end
      and (v_c is null
           or (p_scope <> 'past' and (k.at, a.id) > ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
           or (p_scope = 'past' and (k.at, a.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid)))
    order by ord
    limit v_limit + 1) x;

  v_last := case when jsonb_array_length(v_rows) > v_limit then v_rows -> (v_limit - 1) end;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value - 'k' order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when v_last is null then null else jsonb_build_array(v_last ->> 'k', v_last ->> 'id')::text end);
end;
$$;

select private.lock_down_public_functions();
