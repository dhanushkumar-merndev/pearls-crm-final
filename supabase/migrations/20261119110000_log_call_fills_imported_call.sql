-- Call notes saved after the phone's call-log import are no longer lost (found while recording the
-- leads demo video, 03/11/2026). The phone imports its call log about 20 s after a CRM call; when the
-- salesperson saved the notes sheet later than that, log_call met the imported row (same
-- device_call_key) and returned it as a "repeat": outcome, notes, stage and next call were dropped.
-- Now an imported row ('call_log') is filled in with what the person wrote, and the lead updates run.
-- Same function as 20261101100000_phase9_leads.sql otherwise.

create or replace function public.log_call(p_call jsonb)
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
    -- The phone's call-log import got there first (it runs ~20 s after a call, often while the notes
    -- are still being typed): the person's outcome and notes fill that row in, and the stage / next
    -- call below still apply. Before this, they were dropped as a "repeat".
    if v_row.source = 'call_log' and v_row.staff_id = v_me then
      update public.call_logs set
        outcome = coalesce(v_outcome, outcome),
        notes = nullif(btrim(p_call ->> 'notes'), ''),
        source = 'app',
        lead_id = coalesce(lead_id, v_lead.id),
        patient_id = coalesce(patient_id, v_lead.patient_id)
      where id = v_row.id
      returning * into v_row;
    else
      return to_jsonb(v_row) || jsonb_build_object('repeat', true);
    end if;
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

select private.lock_down_public_functions();
