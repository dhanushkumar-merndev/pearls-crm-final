-- WhatsApp template messages on/off (owner 02/11/2026: "no funds right now, I need a button in
-- Admin → WhatsApp to turn WhatsApp templates on or off") and a guard for test data (the online
-- project is the live WhatsApp number; browser tests create "E2E …" patients and leads with random
-- real-looking numbers).
--  * Setting whatsapp.templates_enabled (default true). Off: no booking confirmations, reminders,
--    new-lead welcomes or drip messages are queued; a staff template send is refused
--    (templates_off); template messages already queued are dropped at sending time. Free text
--    inside Meta's 24-hour window and the chat bot are unaffected (Meta doesn't charge for them).
--    With no reminders delivered, auto-cancel (20261114100000) cancels nothing.
--  * public.wa_templates_switch(on): the Admin → WhatsApp button (admin only).
--  * Test records: names starting "E2E" or "Demo Patient" never get a real WhatsApp, automatic or
--    by hand (dropped at sending time as test_record).

create function private.wa_is_test_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_name ~* '^\s*(e2e|demo patient)\M', false);
$$;

create function private.wa_templates_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.wa_setting('templates_enabled', 'true'))::boolean, true);
$$;

-- The Admin → WhatsApp button. Returns the new state.
create function public.wa_templates_switch(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if p_on is null then
    perform private.fail('invalid_input', 'on');
  end if;
  insert into public.app_settings (section, value) values ('whatsapp', jsonb_build_object('templates_enabled', p_on))
  on conflict (section) do update set value = public.app_settings.value || excluded.value,
                                      version = public.app_settings.version + 1, updated_at = now();
  return p_on;
end;
$$;

-- Changed functions (latest versions from 20261111170000_wa_dnd.sql, plus the checks above).

create or replace function private.wa_enqueue(p jsonb)
returns public.wa_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
  v_tpl public.wa_templates;
  v_row public.wa_messages;
  v_auto boolean := coalesce((p ->> 'auto')::boolean, false);
  v_patient uuid := (p ->> 'patient_id')::uuid;
  v_lead uuid := (p ->> 'lead_id')::uuid;
  v_text text := nullif(btrim(p ->> 'text'), '');
  v_cost integer := 0;
begin
  select * into v_t from private.wa_target(v_patient, v_lead);
  if v_t.phone_e164 is null then
    return null;
  end if;
  if exists (select 1 from public.wa_contacts c where c.phone_e164 = v_t.phone_e164 and c.opted_out_at is not null) then
    return null;
  end if;
  -- Do not disturb (automatic messages): staff can still write by hand.
  if v_auto and exists (select 1 from public.wa_contacts c where c.phone_e164 = v_t.phone_e164 and c.dnd_auto) then
    return null;
  end if;
  if v_auto and (v_t.wa_mode = 'manual' or not coalesce((private.wa_setting('enabled', 'false'))::boolean, false)) then
    return null;
  end if;
  -- Test records (E2E … / Demo Patient …) get no automatic messages (and wa_claim_batch never sends to them).
  if v_auto and private.wa_is_test_name(v_t.name) then
    return null;
  end if;
  -- Template messages switched off (Admin → WhatsApp): automatic ones are skipped, staff are told.
  if v_text is null and not private.wa_templates_on() then
    if v_auto then
      return null;
    end if;
    perform private.fail('templates_off');
  end if;
  if v_text is null then
    if nullif(p ->> 'template_id', '') is not null then
      select * into v_tpl from public.wa_templates where id = (p ->> 'template_id')::uuid and active;
    else
      select * into v_tpl from public.wa_templates where purpose = p ->> 'purpose' and active;
    end if;
    if v_tpl.id is null or upper(v_tpl.status) <> 'APPROVED' then
      return null;
    end if;
    v_cost := case v_tpl.category
      when 'marketing' then coalesce((private.wa_setting('cost_marketing_paise', '88'))::int, 88)
      else coalesce((private.wa_setting('cost_utility_paise', '12'))::int, 12) end;
  end if;
  insert into public.wa_messages (id, patient_id, lead_id, phone_e164, direction, kind, template_id, purpose, body, vars,
                                  status, status_rank, category, est_cost_paise, respect_quiet, scheduled_for, sent_by,
                                  appointment_id, drip_send_id, dedupe_key)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), v_patient, case when v_patient is null then v_lead end,
          v_t.phone_e164, 'outbound', case when v_text is null then 'template' else 'text' end, v_tpl.id,
          coalesce(p ->> 'purpose', v_tpl.purpose), coalesce(v_text, v_tpl.body_text),
          case when v_text is null then private.wa_resolve_vars(v_tpl.variable_map, v_patient, v_lead, (p ->> 'appointment_id')::uuid)
               else '[]'::jsonb end,
          'queued', 0, v_tpl.category, v_cost, v_auto, coalesce((p ->> 'scheduled_for')::timestamptz, now()),
          case when v_auto then null else private.my_staff_id() end, (p ->> 'appointment_id')::uuid,
          (p ->> 'drip_send_id')::uuid, nullif(p ->> 'dedupe_key', ''))
  on conflict do nothing
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.wa_claim_batch(p_limit integer default 20, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quiet boolean := private.wa_is_quiet(p_now);
  v_out jsonb := '[]'::jsonb;
  v_m record;
begin
  -- Automatic messages caught by quiet hours move to the end of them.
  if v_quiet then
    update public.wa_messages set scheduled_for = private.wa_after_quiet(p_now)
    where status = 'queued' and respect_quiet and scheduled_for <= p_now;
  end if;
  update public.wa_messages m set status = 'failed', status_rank = 2, error_code = 'opted_out', error_text = 'opted out',
                                  status_at = p_now
  where m.status = 'queued' and exists (select 1 from public.wa_contacts c where c.phone_e164 = m.phone_e164 and c.opted_out_at is not null);
  -- Automatic messages queued before Do not disturb was switched on.
  update public.wa_messages m set status = 'failed', status_rank = 2, error_code = 'dnd', error_text = 'do not disturb',
                                  status_at = p_now
  where m.status = 'queued' and m.respect_quiet
    and exists (select 1 from public.wa_contacts c where c.phone_e164 = m.phone_e164 and c.dnd_auto);
  -- Template messages switched off: queued ones are not sent (free replies inside 24 h still go).
  if not private.wa_templates_on() then
    update public.wa_messages m set status = 'failed', status_rank = 2, error_code = 'templates_off',
                                    error_text = 'template messages are switched off', status_at = p_now
    where m.status = 'queued' and m.kind = 'template';
  end if;
  -- Test records never get a real WhatsApp, whoever queued it.
  update public.wa_messages m set status = 'failed', status_rank = 2, error_code = 'test_record',
                                  error_text = 'test record: not sent', status_at = p_now
  where m.status = 'queued' and (m.patient_id is not null or m.lead_id is not null)
    and private.wa_is_test_name((select t.name from private.wa_target(m.patient_id, m.lead_id) t));
  for v_m in
    select m.* from public.wa_messages m
    where m.status = 'queued' and m.scheduled_for <= p_now and (m.locked_until is null or m.locked_until < p_now)
    order by m.scheduled_for, m.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  loop
    update public.wa_messages set locked_until = p_now + interval '2 minutes', attempts = attempts + 1 where id = v_m.id;
    v_out := v_out || jsonb_build_object(
      'id', v_m.id, 'to', v_m.phone_e164, 'kind', v_m.kind, 'text', v_m.body, 'vars', v_m.vars, 'payload', v_m.payload,
      'template', (select jsonb_build_object('name', t.name, 'language', t.language, 'components', t.components)
                   from public.wa_templates t where t.id = v_m.template_id));
  end loop;
  return v_out;
end;
$$;

-- Fix: a template sent without a booking (welcome, follow-up, a chat send) failed with
-- "record v_appt is not assigned yet" as soon as its variables were filled in. Plain variables now.
create or replace function private.wa_resolve_vars(p_map jsonb, p_patient uuid, p_lead uuid, p_appointment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_key text;
  v_val text;
  v_name text;
  v_clinic public.clinic_settings;
  v_slot timestamptz;
  v_doctor text;
begin
  select t.name into v_name from private.wa_target(p_patient, p_lead) t;
  select * into v_clinic from public.clinic_settings where branch_code = 'main';
  if p_appointment is not null then
    select a.slot_start, coalesce(d.display_name, d.full_name) into v_slot, v_doctor
    from public.appointments a left join public.doctors d on d.id = a.doctor_id where a.id = p_appointment;
  end if;
  for v_key in select jsonb_array_elements_text(coalesce(p_map, '[]'::jsonb)) loop
    v_val := case v_key
      when 'name' then v_name
      when 'first_name' then split_part(coalesce(v_name, ''), ' ', 1)
      when 'clinic_name' then v_clinic.name
      when 'clinic_phone' then v_clinic.phones[1]
      when 'appt_date' then to_char(private.ist(v_slot), 'DD/MM/YYYY')
      when 'appt_time' then ltrim(to_char(private.ist(v_slot), 'HH12:MI AM'), '0')
      when 'doctor' then v_doctor
      when 'uhid' then (select uhid from public.patients where id = p_patient)
      when 'treatment' then coalesce(
        (select t.name from public.patient_treatments t where t.patient_id = p_patient and t.status <> 'cancelled'
          order by t.start_date desc limit 1),
        (select coalesce(tt.name, l.treatment_text) from public.leads l
           left join public.treatment_templates tt on tt.id = l.treatment_template_id where l.id = p_lead))
      else null end;
    v_out := v_out || to_jsonb(coalesce(nullif(btrim(v_val), ''), '-'));
  end loop;
  return v_out;
end;
$$;


select private.lock_down_public_functions();
