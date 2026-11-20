-- WhatsApp monthly budget for template messages (owner, 20/11/2026: "in admin for template message I
-- need a budget limit they can set, so it will not send template messages").
--  * Setting whatsapp.monthly_budget_paise: null = no limit. Set by public.wa_set_budget (admin).
--  * Spent = the estimated cost (Admin → WhatsApp prices) of template messages sent this month (IST),
--    plus those being handed to Meta right now. Meta's invoice stays the real amount.
--  * When the next template message would go over the budget: automatic ones (booking confirmation,
--    reminder, new-lead welcome, drips) are skipped, a staff send is refused (budget_reached), and
--    ones already queued are dropped at sending time. Free replies within Meta's 24 hours and the chat
--    bot still go. A new month (1st, IST) or a higher budget starts template messages again.
--  * Admins get one bell alert at 80 % and one when the budget is reached, each once a month.

-- Estimated cost of one template message of this category (the prices set on Admin → WhatsApp).
create function private.wa_template_cost(p_category public.template_category)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case p_category
    when 'marketing' then coalesce((private.wa_setting('cost_marketing_paise', '88'))::int, 88)
    else coalesce((private.wa_setting('cost_utility_paise', '12'))::int, 12) end;
$$;

-- The monthly budget in paise, or null for no limit.
create function private.wa_budget()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(private.wa_setting('monthly_budget_paise', 'null') #>> '{}', '')::bigint;
$$;

-- This month's (IST) estimated spend on template messages: sent, or being handed to Meta now.
create function private.wa_month_spent(p_now timestamptz default now())
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.est_cost_paise), 0)::bigint
  from public.wa_messages m
  where m.direction = 'outbound' and m.kind = 'template'
    and m.created_at >= private.ist_at(date_trunc('month', private.ist(p_now))::date, '00:00')
    and (m.status in ('sent', 'delivered', 'read') or (m.status = 'queued' and m.locked_until > p_now));
$$;

-- Would one more template message of this cost go over the budget?
create function private.wa_over_budget(p_cost integer, p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.wa_budget() is not null and private.wa_month_spent(p_now) + coalesce(p_cost, 0) > private.wa_budget();
$$;

-- One bell alert per month for admins: at 80 % used, and when the budget is reached.
create function private.wa_budget_alert(p_reached boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month text := to_char(private.ist(now()), 'YYYY-MM');
begin
  if p_reached then
    perform private.notify_admins('wa_budget', 'WhatsApp budget reached',
      'Template messages (confirmations, reminders, welcomes) are paused until the 1st or until the budget is raised.',
      '/admin/whatsapp', 'wa_budget_100:' || v_month);
  else
    perform private.notify_admins('wa_budget', 'WhatsApp budget 80% used',
      'Template messages stop when the monthly budget is reached.', '/admin/whatsapp', 'wa_budget_80:' || v_month);
  end if;
end;
$$;

-- Admin → WhatsApp → Template messages → Monthly budget. Null = no limit. Returns the saved value.
create function public.wa_set_budget(p_budget_paise bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if p_budget_paise is not null and (p_budget_paise < 100 or p_budget_paise > 10000000000) then
    perform private.fail('invalid_input', 'budget');
  end if;
  insert into public.app_settings (section, value)
  values ('whatsapp', jsonb_build_object('monthly_budget_paise', p_budget_paise))
  on conflict (section) do update set value = public.app_settings.value || excluded.value,
                                      version = public.app_settings.version + 1, updated_at = now();
  return p_budget_paise;
end;
$$;

-- Changed functions (latest versions, plus the budget checks above).

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
    v_cost := private.wa_template_cost(v_tpl.category);
    -- Monthly budget (Admin → WhatsApp): automatic ones are skipped (admins are told once), staff are told.
    if private.wa_over_budget(v_cost) then
      if v_auto then
        perform private.wa_budget_alert(true);
        return null;
      end if;
      perform private.fail('budget_reached');
    end if;
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
  v_budget bigint := private.wa_budget();
  v_spent bigint := 0;
  v_dropped boolean := false;
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
  if v_budget is not null then
    v_spent := private.wa_month_spent(p_now);
  end if;
  for v_m in
    select m.* from public.wa_messages m
    where m.status = 'queued' and m.scheduled_for <= p_now and (m.locked_until is null or m.locked_until < p_now)
    order by m.scheduled_for, m.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  loop
    -- Monthly budget: a template message that would go over it is not sent (free replies still go).
    if v_budget is not null and v_m.kind = 'template' then
      if v_spent + v_m.est_cost_paise > v_budget then
        update public.wa_messages set status = 'failed', status_rank = 2, error_code = 'budget_reached',
                                      error_text = 'monthly WhatsApp budget reached', status_at = p_now
        where id = v_m.id;
        v_dropped := true;
        continue;
      end if;
      v_spent := v_spent + v_m.est_cost_paise;
    end if;
    update public.wa_messages set locked_until = p_now + interval '2 minutes', attempts = attempts + 1 where id = v_m.id;
    v_out := v_out || jsonb_build_object(
      'id', v_m.id, 'to', v_m.phone_e164, 'kind', v_m.kind, 'text', v_m.body, 'vars', v_m.vars, 'payload', v_m.payload,
      'template', (select jsonb_build_object('name', t.name, 'language', t.language, 'components', t.components)
                   from public.wa_templates t where t.id = v_m.template_id));
  end loop;
  if v_budget is not null and (v_dropped or v_spent * 5 >= v_budget * 4) then
    perform private.wa_budget_alert(false);
  end if;
  if v_budget is not null and (v_dropped or v_spent >= v_budget) then
    perform private.wa_budget_alert(true);
  end if;
  return v_out;
end;
$$;

create or replace function public.wa_send_reminder(p_appointment_id uuid, p_text text, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments;
  v_lead uuid;
  v_t record;
  v_row public.wa_messages;
  v_text text := nullif(btrim(p_text), '');
  v_key text;
  v_window boolean;
  v_block text;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  if p_client_id is null or p_appointment_id is null then
    perform private.fail('invalid_input');
  end if;
  select * into v_row from public.wa_messages where id = p_client_id;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true, 'manual', v_row.kind = 'manual');
  end if;
  select * into v_a from public.appointments where id = p_appointment_id;
  if not found then
    perform private.fail('not_found');
  end if;
  v_lead := case when v_a.patient_id is null then v_a.lead_id end;
  perform private.wa_can_message(v_a.patient_id, v_lead);
  -- Only before the visit: not once arrived, done, no-show, cancelled, or the time has passed.
  if v_a.status not in ('pending_confirmation', 'confirmed') or v_a.slot_start is null or v_a.slot_start <= now() then
    perform private.fail('reminder_not_upcoming');
  end if;
  select * into v_t from private.wa_target(v_a.patient_id, v_lead);
  if v_t.phone_e164 is null then
    perform private.fail('invalid_input', 'phone');
  end if;
  if exists (select 1 from public.wa_contacts c where c.phone_e164 = v_t.phone_e164 and c.opted_out_at is not null) then
    perform private.fail('opted_out');
  end if;

  -- Cloud API off, or this person is messaged by hand: log it, the app opens WhatsApp with the text.
  if not coalesce((private.wa_setting('enabled', 'false'))::boolean, false) or v_t.wa_mode = 'manual' then
    if v_text is null or length(v_text) > 4096 then
      perform private.fail('invalid_input', 'text');
    end if;
    insert into public.wa_messages (id, patient_id, lead_id, phone_e164, direction, kind, purpose, body, status, status_rank,
                                    sent_by, appointment_id)
    values (p_client_id, v_a.patient_id, v_lead, v_t.phone_e164, 'outbound', 'manual', 'appointment_reminder', v_text,
            'manual', 1, private.my_staff_id(), v_a.id)
    returning * into v_row;
    return to_jsonb(v_row) || jsonb_build_object('repeat', false, 'manual', true);
  end if;

  -- The first reminder takes the automatic one's place; a second one by hand is just another message.
  v_key := case when exists (select 1 from public.wa_messages m where m.dedupe_key = 'reminder:' || v_a.id)
                then null else 'reminder:' || v_a.id end;
  -- Template messages off, or this month's budget used: the reminder can still go as free text below.
  v_block := case
    when not private.wa_templates_on() then 'templates_off'
    when private.wa_over_budget(coalesce((select private.wa_template_cost(t.category) from public.wa_templates t
                                           where t.purpose = 'appointment_reminder' and t.active limit 1), 0)) then 'budget_reached'
  end;
  if v_block is null then
    v_row := private.wa_enqueue(jsonb_build_object(
      'id', p_client_id, 'patient_id', v_a.patient_id, 'lead_id', v_lead, 'appointment_id', v_a.id,
      'purpose', 'appointment_reminder', 'auto', false, 'dedupe_key', v_key));
  end if;
  if v_row.id is null then
    -- No template to use: free text inside the 24 hours after they last wrote to us.
    v_window := exists (select 1 from public.wa_contacts c where c.phone_e164 = v_t.phone_e164
                        and c.last_inbound_at >= now() - interval '24 hours');
    if not v_window or v_text is null or length(v_text) > 4096 then
      perform private.fail(coalesce(v_block, 'no_reminder_template'));
    end if;
    v_row := private.wa_enqueue(jsonb_build_object(
      'id', p_client_id, 'patient_id', v_a.patient_id, 'lead_id', v_lead, 'appointment_id', v_a.id,
      'purpose', 'appointment_reminder', 'auto', false, 'text', v_text, 'dedupe_key', v_key));
  end if;
  if v_lead is not null then
    perform private.lead_log(v_lead, 'whatsapp', v_row.body, jsonb_build_object('message_id', v_row.id));
    update public.leads set last_activity_at = now() where id = v_lead;
  end if;
  return to_jsonb(v_row) || jsonb_build_object('repeat', false, 'manual', false);
end;
$$;

create or replace function public.wa_number_send(p_phone text, p jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.wa_contacts;
  v_tpl public.wa_templates;
  v_row public.wa_messages;
  v_text text := nullif(btrim(p ->> 'text'), '');
  v_cost integer := 0;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if p_client_id is null or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.fail('invalid_input');
  end if;
  select * into v_row from public.wa_messages where id = p_client_id;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;
  if not coalesce((private.wa_setting('enabled', 'false'))::boolean, false) then
    perform private.fail('whatsapp_off');
  end if;
  select * into v_contact from public.wa_contacts where phone_e164 = p_phone;
  if v_contact.opted_out_at is not null then
    perform private.fail('opted_out');
  end if;
  if v_text is not null then
    if length(v_text) > 4096 then
      perform private.fail('invalid_input', 'text');
    end if;
    -- Free text only inside the 24 hours after the person last wrote to us (Meta's rule).
    if v_contact.last_inbound_at is null or v_contact.last_inbound_at < now() - interval '24 hours' then
      perform private.fail('outside_window');
    end if;
  else
    select * into v_tpl from public.wa_templates where id = (nullif(p ->> 'template_id', ''))::uuid and active;
    if v_tpl.id is null or upper(v_tpl.status) <> 'APPROVED' then
      perform private.fail('invalid_input', 'template');
    end if;
    -- Template messages switched off, or this month's budget used (Admin → WhatsApp).
    if not private.wa_templates_on() then
      perform private.fail('templates_off');
    end if;
    v_cost := private.wa_template_cost(v_tpl.category);
    if private.wa_over_budget(v_cost) then
      perform private.fail('budget_reached');
    end if;
  end if;
  insert into public.wa_messages (id, phone_e164, direction, kind, template_id, purpose, body, vars, status, status_rank,
                                  category, est_cost_paise, respect_quiet, scheduled_for, sent_by)
  values (p_client_id, p_phone, 'outbound', case when v_text is null then 'template' else 'text' end, v_tpl.id, v_tpl.purpose,
          coalesce(v_text, v_tpl.body_text),
          case when v_text is null then private.wa_resolve_vars(v_tpl.variable_map, null, null, null) else '[]'::jsonb end,
          'queued', 0, v_tpl.category, v_cost, false, now(), private.my_staff_id())
  returning * into v_row;
  return to_jsonb(v_row) || jsonb_build_object('repeat', false);
exception
  when invalid_text_representation then
    perform private.fail('invalid_input');
end;
$$;

select private.lock_down_public_functions();
