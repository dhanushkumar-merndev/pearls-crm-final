-- Auto-cancel bookings nobody confirmed (owner 02/11/2026: "12 hours before, if still not confirmed,
-- auto-cancel and tell admin, reception and the lead's salesperson so they can call; they confirm it
-- again or leave it cancelled").
--  * Settings → Appointments → "Auto-cancel if not confirmed (hours before)", default 12, 0 = off.
--  * Only bookings whose WhatsApp reminder reached the patient at least 2 hours earlier, booked before
--    that window opened, not walk-ins. No reminder (WhatsApp off, template not set) → never cancelled.
--  * The booking becomes Cancelled ("Not confirmed (auto)"), the slot opens, one "call to confirm" task
--    and one alert (bell + phone push) per admin, receptionist and the lead's assigned salesperson.
--  * "Confirm" on an auto-cancelled booking (web, phone, or YES on WhatsApp) restores it if the slot is
--    still free; "Cancel" keeps it cancelled with a reason.
--  * my_notifications(): the alerts list for the phone app (admin and reception now use it for alerts).

alter table public.appointments add column auto_cancelled_at timestamptz;
create index appointments_auto_cancelled on public.appointments (slot_start) where auto_cancelled_at is not null;

------------------------------------------------------------------------------
-- Alerts about one booking
------------------------------------------------------------------------------
-- p_kind: cancelled | restored (YES on WhatsApp, slot free) | taken (YES, but the slot is gone).
-- Goes to every active admin and receptionist, and the lead's assigned salesperson (if any).
create function private.notify_appt_people(p_appt public.appointments, p_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, link, dedupe_key)
  select s.id, 'appointment_auto_cancelled',
         case p_kind when 'cancelled' then 'Booking auto-cancelled: '
                     when 'restored' then 'Confirmed on WhatsApp: '
                     else 'Said YES, but the slot is taken: ' end || x.who,
         coalesce(x.doctor || ' · ', '') || x.at || ' — ' ||
         case p_kind when 'cancelled' then 'not confirmed. Call to confirm again, or leave it cancelled.'
                     when 'restored' then 'the auto-cancelled booking is back on. No call needed.'
                     else 'offer the patient another time.' end,
         case when s.role in ('admin', 'receptionist') then '/appointments?auto=1&date=' || p_appt.appt_date::text
              else '/leads/' || p_appt.lead_id::text end,
         'appt_' || p_kind || ':' || p_appt.id || ':' || s.id
  from (
    select coalesce(p.full_name, l.name, 'Patient') as who, coalesce(d.display_name, d.full_name) as doctor,
           to_char(private.ist(p_appt.slot_start), 'DD/MM/YYYY FMHH12:MI AM') as at, l.assigned_to
    from (select 1) one
    left join public.patients p on p.id = p_appt.patient_id
    left join public.leads l on l.id = p_appt.lead_id and l.deleted_at is null
    left join public.doctors d on d.id = p_appt.doctor_id
  ) x
  join public.staff s on s.active and (s.role in ('admin', 'receptionist') or s.id = x.assigned_to)
  on conflict (dedupe_key) do nothing;
$$;

------------------------------------------------------------------------------
-- Restore an auto-cancelled booking (slot still free) as confirmed
------------------------------------------------------------------------------
create function private.appt_restore(p_id uuid, p_via public.confirm_via, p_by uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments;
begin
  select * into v_row from public.appointments where id = p_id for update;
  if not found or v_row.status <> 'cancelled' or v_row.auto_cancelled_at is null then
    perform private.fail('invalid_status_change', 'not auto-cancelled');
  end if;
  perform private.lock_slot(v_row.doctor_id, v_row.slot_start);
  -- Refuses with slot_full / slot_in_past / doctor_on_leave / holiday like a new booking.
  perform 1 from private.check_slot(v_row.doctor_id, v_row.slot_start, v_row.id);
  perform set_config('app.reason', 'Restored after auto-cancel', true);
  update public.appointments set
    status = 'confirmed', confirmed_via = p_via, confirmed_at = now(), confirmed_by = p_by,
    cancel_reason = null, auto_cancelled_at = null, version = version + 1
  where id = p_id
  returning * into v_row;
  update public.followups set status = 'done', done_at = now(), done_by = p_by, outcome = 'restored and confirmed'
   where kind = 'call_to_confirm' and ref_table = 'appointments' and ref_id = p_id and status = 'open';
  return v_row;
end;
$$;

------------------------------------------------------------------------------
-- The timer: every 15 minutes
------------------------------------------------------------------------------
create function private.appointment_auto_cancel()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer := coalesce((private.setting('appointments', 'auto_cancel_hours_before', '12'))::int, 12);
  v_reason constant text := 'Not confirmed (auto)';
  v_task constant text := 'Booking auto-cancelled (not confirmed): call to confirm again, or leave it cancelled';
  v_n integer := 0;
  v_id uuid;
  v_row public.appointments;
begin
  if v_hours <= 0 then
    return 0;
  end if;
  for v_id in
    select a.id from public.appointments a
    where a.status = 'pending_confirmation' and not a.is_walk_in
      and a.slot_start > now() and a.slot_start <= now() + make_interval(hours => v_hours)
      -- Booked inside the window (e.g. this morning for this evening): no time to answer; staff call instead.
      and a.created_at <= a.slot_start - make_interval(hours => v_hours)
      -- The reminder reached them, at least 2 hours ago.
      and exists (select 1 from public.wa_messages m
                  where m.dedupe_key = 'reminder:' || a.id and m.status in ('sent', 'delivered', 'read')
                    and coalesce(m.scheduled_for, m.created_at) <= now() - interval '2 hours')
    order by a.slot_start
    limit 200
  loop
    perform set_config('app.reason', v_reason, true);
    update public.appointments set status = 'cancelled', cancel_reason = v_reason, auto_cancelled_at = now(),
                                   version = version + 1
     where id = v_id and status = 'pending_confirmation'
    returning * into v_row;
    continue when not found;
    -- One open "call to confirm" task: the existing one gets the new reason, else a new one.
    update public.followups set reason = v_task, due_date = (private.ist(now()))::date, due_at = now()
     where kind = 'call_to_confirm' and ref_table = 'appointments' and ref_id = v_id and status = 'open';
    if not found then
      insert into public.followups (kind, patient_id, lead_id, due_date, due_at, reason, source, assigned_to, ref_table, ref_id)
      select 'call_to_confirm', v_row.patient_id, v_row.lead_id, (private.ist(now()))::date, now(), v_task, 'system',
             (select l.assigned_to from public.leads l where l.id = v_row.lead_id and v_row.patient_id is null and l.deleted_at is null),
             'appointments', v_id
      on conflict (kind, ref_table, ref_id) where ref_id is not null and status = 'open' do nothing;
    end if;
    perform private.notify_appt_people(v_row, 'cancelled');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

select cron.schedule('appointment-auto-cancel', '*/15 * * * *', $$select private.appointment_auto_cancel()$$);

------------------------------------------------------------------------------
-- Alerts list for the phone app (newest first; the bell on the web reads the table directly)
------------------------------------------------------------------------------
create function public.my_notifications(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', n.id, 'type', n.type, 'title', n.title, 'body', n.body, 'link', n.link,
             'read', n.read_at is not null, 'created_at', n.created_at) order by n.created_at desc), '[]'::jsonb)
    from (select * from public.notifications
          where recipient_id = v_me and type <> 'locate_now'
          order by created_at desc
          limit least(greatest(coalesce(p_limit, 50), 1), 100)) n);
end;
$$;

------------------------------------------------------------------------------
-- Changed functions (copied from their latest versions; the change is marked in a comment)
------------------------------------------------------------------------------
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
    'lead_only', a.patient_id is null and a.lead_id is not null, 'lead_sl_no', l.sl_no,
    'auto_cancelled', a.status = 'cancelled' and a.auto_cancelled_at is not null)
  from (select 1) one
  left join public.leads l on l.id = a.lead_id;
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
  -- An auto-cancelled booking (not confirmed in time): "confirm" restores it if its slot is still
  -- free; "cancel" keeps it cancelled with this person's reason (someone has now decided).
  if v_row.status = 'cancelled' and v_row.auto_cancelled_at is not null and p_status in ('confirmed', 'cancelled') then
    if p_status = 'confirmed' then
      v_row := private.appt_restore(v_row.id,
        (case when private.has_role('sales_executive', 'sales_manager') then 'sales_call' else 'reception' end)::public.confirm_via, v_staff);
    else
      if length(btrim(coalesce(p_reason, ''))) < 3 then
        perform private.fail('invalid_input', 'reason');
      end if;
      perform set_config('app.reason', p_reason, true);
      update public.appointments set cancel_reason = btrim(p_reason), auto_cancelled_at = null, version = version + 1
       where id = p_id
      returning * into v_row;
      update public.followups set status = 'cancelled', done_at = now(), done_by = v_staff, outcome = 'kept cancelled'
       where kind = 'call_to_confirm' and ref_table = 'appointments' and ref_id = v_row.id and status = 'open';
    end if;
    return to_jsonb(v_row);
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
    where (a.status = 'pending_confirmation' or (a.status = 'cancelled' and a.auto_cancelled_at is not null))
      and a.slot_start > now()
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
    'auto_cancelled', coalesce((
      select jsonb_agg(x.card order by x.slot_start)
      from (
        select private.appt_card(a, p) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name)) as card, a.slot_start
        from public.appointments a
        left join public.patients p on p.id = a.patient_id
        left join public.doctors d on d.id = a.doctor_id
        where a.auto_cancelled_at is not null and a.status = 'cancelled' and a.slot_start > now()
        order by a.slot_start
        limit 50) x), '[]'::jsonb),
    'followups_due', (select count(*) from public.followups f
                       where f.status = 'open' and f.due_date <= v_day and (f.assigned_to is null or f.patient_id is not null)),
    'pending_registrations', (select count(*) from public.registration_requests where status = 'pending'),
    'sessions_due_week', (select count(*) from public.treatment_sessions s
                           join public.patient_treatments t on t.id = s.treatment_id and t.status = 'active'
                          where s.status in ('planned', 'missed') and s.planned_date between v_day and v_day + 6));
end;
$$;

create or replace function public.appointments_table(p_filters jsonb default '{}', p_sort text default 'slot_start',
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
  v_auto boolean := coalesce((p_filters ->> 'auto_cancelled')::boolean, false);
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
        and (not $7 or (a.status = 'cancelled' and a.auto_cancelled_at is not null))
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(private.appt_card(x.a, x.p) || jsonb_build_object('doctor', x.doctor))
        from (select * from filtered f order by %s %s nulls last, (f.a).id limit $5 offset $6) x), '[]'::jsonb))
  $q$, v_order, case when p_desc then 'desc' else 'asc' end)
  into v_result using v_from, v_to, v_statuses, v_doctor, v_limit, greatest(coalesce(p_offset, 0), 0), v_auto;
  return v_result;
end;
$$;

create or replace function public.wa_inbound(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := p ->> 'from';
  v_at timestamptz := coalesce((p ->> 'at')::timestamptz, now());
  v_action text := nullif(p ->> 'action', '');
  v_patient uuid;
  v_lead uuid;
  v_msg public.wa_messages;
  v_appt public.appointments;
  v_done text;
  v_bot integer := 0;
begin
  if coalesce(v_from, '') !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.fail('invalid_input', 'from');
  end if;
  select id into v_patient from public.patients
   where merged_into_id is null and right(v_from, 10) in (whatsapp_last10, phone_last10)
   order by updated_at desc limit 1;
  if v_patient is null then
    select id into v_lead from public.leads where deleted_at is null and right(v_from, 10) in (phone_last10, alt_phone_last10)
     order by created_at desc limit 1;
  end if;
  insert into public.wa_messages (patient_id, lead_id, phone_e164, direction, kind, body, wa_message_id, status, status_rank,
                                  status_at, context_wa_id, created_at)
  values (v_patient, v_lead, v_from, 'inbound',
          case when p ->> 'kind' in ('text', 'button_reply', 'media') then p ->> 'kind' else 'other' end,
          left(p ->> 'text', 4096), p ->> 'wa_message_id', 'received', 0, v_at, p ->> 'context_wa_id', v_at)
  on conflict (wa_message_id) do nothing
  returning * into v_msg;
  if v_msg.id is null then
    return jsonb_build_object('status', 'repeat');
  end if;
  insert into public.wa_contacts (phone_e164, last_inbound_at) values (v_from, v_at)
  on conflict (phone_e164) do update set last_inbound_at = greatest(public.wa_contacts.last_inbound_at, excluded.last_inbound_at),
                                          updated_at = now();
  -- Any reply stops drips that stop on reply.
  update public.drip_enrollments e set status = 'stopped', stopped_reason = 'replied', next_send_at = null
  from public.drip_campaigns c
  where c.id = e.campaign_id and c.stop_on_reply and e.status in ('active', 'paused')
    and ((v_patient is not null and e.patient_id = v_patient) or (v_lead is not null and e.lead_id = v_lead));
  if v_lead is not null then
    perform private.lead_log(v_lead, 'whatsapp_in', left(p ->> 'text', 2000), jsonb_build_object('message_id', v_msg.id));
    update public.leads set last_activity_at = now() where id = v_lead;
    perform private.notify_staff((select assigned_to from public.leads where id = v_lead), 'whatsapp_reply',
      'WhatsApp reply', left(p ->> 'text', 200), '/leads/' || v_lead, 'wa_in:' || v_msg.id);
  end if;

  if v_action = 'stop' then
    update public.wa_contacts set opted_out_at = v_at, opt_out_source = 'keyword', updated_at = now() where phone_e164 = v_from;
    perform private.drip_stop_for_phone(v_from, 'opted out');
    update public.wa_bot_sessions set status = 'stopped', ended_at = now() where phone_e164 = v_from and status = 'active';
    -- Tell them it worked (free text is allowed: they just wrote).
    insert into public.wa_messages (patient_id, lead_id, phone_e164, direction, kind, body, status, status_rank)
    values (v_patient, v_lead, v_from, 'outbound', 'text',
            coalesce(nullif(btrim(private.wa_setting('stop_reply', 'null') #>> '{}'), ''),
                     'You won''t get WhatsApp messages from us any more. Reply START to get them again.'), 'queued', 0);
    v_done := 'stop';
  elsif v_action = 'start' then
    update public.wa_contacts set opted_out_at = null, opt_out_source = null, updated_at = now() where phone_e164 = v_from;
    v_done := 'start';
  elsif v_action in ('confirm', 'reschedule') then
    -- The nearest upcoming booking of this person; a reply after its time does nothing.
    select a.* into v_appt from public.appointments a
    where ((v_patient is not null and a.patient_id = v_patient) or (v_lead is not null and a.lead_id = v_lead))
      and a.slot_start > v_at
      and (a.status in ('pending_confirmation', 'confirmed') or (a.status = 'cancelled' and a.auto_cancelled_at is not null))
    order by a.slot_start limit 1
    for update;
    if v_appt.id is not null and v_action = 'confirm' and v_appt.status = 'pending_confirmation' then
      update public.appointments set status = 'confirmed', confirmed_via = 'whatsapp', confirmed_at = now(), version = version + 1
      where id = v_appt.id;
      update public.followups set status = 'done', done_at = now(), outcome = 'confirmed on WhatsApp'
      where kind = 'call_to_confirm' and ref_table = 'appointments' and ref_id = v_appt.id and status = 'open';
      v_done := 'confirmed';
    elsif v_appt.id is not null and v_action = 'confirm' and v_appt.status = 'cancelled' then
      -- Auto-cancelled, then YES: back on if the slot is still free; else staff offer another time.
      begin
        v_appt := private.appt_restore(v_appt.id, 'whatsapp', null);
        perform private.notify_appt_people(v_appt, 'restored');
        v_done := 'confirmed';
      exception when sqlstate 'P0001' then
        update public.followups set reason = 'Said YES on WhatsApp, but the slot is taken: offer another time',
               due_date = (private.ist(now()))::date, due_at = now()
         where kind = 'call_to_confirm' and ref_table = 'appointments' and ref_id = v_appt.id and status = 'open';
        perform private.notify_appt_people(v_appt, 'taken');
        v_done := 'reschedule';
      end;
    elsif v_appt.id is not null and v_action = 'reschedule' then
      insert into public.followups (kind, patient_id, lead_id, due_date, reason, source, ref_table, ref_id)
      values ('reschedule_request', v_appt.patient_id, v_appt.lead_id, (private.ist(now()))::date,
              left('Asked on WhatsApp to change the booking: ' || coalesce(p ->> 'text', ''), 500), 'system', 'appointments', v_appt.id)
      on conflict do nothing;
      v_done := 'reschedule';
    end if;
  end if;
  if v_done is not null then
    update public.wa_messages set action = case v_done when 'confirmed' then 'confirmed' else v_done end where id = v_msg.id;
  elsif v_action is distinct from 'start' then
    v_bot := private.wa_bot_on_inbound(v_msg, p);
  end if;
  return jsonb_build_object('status', 'new', 'action', v_done, 'appointment_id', v_appt.id, 'patient_id', v_patient,
                            'lead_id', v_lead, 'bot', v_bot);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;


select private.lock_down_public_functions();
