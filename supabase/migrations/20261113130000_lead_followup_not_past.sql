-- Owner 02/11/2026: "while creating leads the follow-up should be future or current time".
-- A new lead's next call, and a changed next call on the lead page, can't be in the past.
-- Five minutes of slack covers a form left open for a moment and a phone clock a little behind.
-- Not checked: log_call (the phone app logs calls offline and syncs later, so its follow-up
-- can be a past time by the time it arrives) and lead imports (old sheets carry past dates).
-- Re-sending the time a lead already has is allowed (an unchanged value is not a new choice).

create or replace function private.check_followup_not_past(p_at timestamptz, p_current timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_at is not null and p_at is distinct from p_current and p_at < now() - interval '5 minutes' then
    perform private.fail('followup_in_past', 'next_followup_at');
  end if;
end;
$$;

create or replace function public.create_lead(p_lead jsonb, p_client_id uuid)
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
  perform private.check_followup_not_past(nullif(p_lead ->> 'next_followup_at', '')::timestamptz, null);
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
  when invalid_text_representation or invalid_datetime_format or check_violation or not_null_violation then
    perform private.fail('invalid_input');
end;
$$;

create or replace function public.update_lead(p_id uuid, p_patch jsonb, p_version integer)
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
  if p_patch ? 'next_followup_at' then
    perform private.check_followup_not_past(nullif(p_patch ->> 'next_followup_at', '')::timestamptz, v_old.next_followup_at);
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

select private.lock_down_public_functions();
