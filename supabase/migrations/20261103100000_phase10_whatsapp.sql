-- Pearl CRM — Phase 10: WhatsApp Cloud API and drip campaigns (PLAN.md C3 "Messaging", D2 "WhatsApp", D3).
-- The database decides WHAT to send and records everything; the wa-dispatch Edge Function sends
-- queued messages to Meta, and wa-webhook brings back statuses and replies.
--   • Every outgoing message is a row first (status queued), so a retry never sends twice
--     (dedupe keys for reminders and confirmations, one row per drip step).
--   • Statuses only move up (sent → delivered → read); a late "sent" never undoes "read".
--   • Free text only inside the 24 hours after the patient last wrote; templates any time.
--   • Opted-out numbers (STOP) get nothing until they write START.
--   • Automatic messages (reminders, drips) wait outside quiet hours; staff sends go at once.
-- Keyword understanding (YES / ಹೌದು / हाँ / STOP …) lives in the webhook (tested in Deno); the
-- database applies the action it is given.

create extension if not exists pg_net with schema extensions;

create type public.wa_direction as enum ('outbound', 'inbound');
create type public.wa_status as enum ('queued', 'sent', 'delivered', 'read', 'failed', 'received', 'manual');
create type public.template_category as enum ('marketing', 'utility', 'authentication');
create type public.drip_status as enum ('active', 'paused', 'completed', 'stopped');

-- Highest wins: a late or repeated status never moves a message backwards.
create function private.wa_status_rank(p_status public.wa_status)
returns smallint
language sql
immutable
parallel safe
as $$
  select (case p_status
    when 'queued' then 0 when 'received' then 0 when 'manual' then 1 when 'sent' then 1
    when 'failed' then 2 when 'delivered' then 3 when 'read' then 4 end)::smallint;
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------
create table public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  meta_id text unique,
  name text not null check (name ~ '^[a-z0-9_]+$' and length(name) <= 512),
  language text not null default 'en' check (language ~ '^[a-zA-Z_]{2,10}$'),
  category public.template_category not null default 'utility',
  status text not null default 'APPROVED' check (length(status) <= 40),
  components jsonb not null default '[]'::jsonb check (jsonb_typeof(components) = 'array'),
  body_text text check (length(body_text) <= 2000),
  param_count smallint not null default 0 check (param_count between 0 and 20),
  -- What the CRM uses it for; one active template per purpose (except "other").
  purpose text check (purpose in ('appointment_booked', 'appointment_reminder', 'lead_welcome', 'followup', 'other')),
  -- Which value fills {{1}}, {{2}}…: ["name", "appt_date", …] (see private.wa_resolve_vars).
  variable_map jsonb not null default '[]'::jsonb check (jsonb_typeof(variable_map) = 'array'),
  active boolean not null default true,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (name, language)
);
create unique index wa_templates_purpose on public.wa_templates (purpose) where purpose is not null and purpose <> 'other' and active;
create trigger wa_templates_touch before update on public.wa_templates
  for each row execute function private.touch_updated();
create trigger wa_templates_audit after insert or update or delete on public.wa_templates
  for each row execute function private.audit_row();

create table public.wa_contacts (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  last_inbound_at timestamptz,
  opted_out_at timestamptz,
  opt_out_source text check (opt_out_source in ('keyword', 'staff')),
  updated_at timestamptz not null default now()
);
create trigger wa_contacts_audit after insert or update or delete on public.wa_contacts
  for each row execute function private.audit_row();

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients (id),
  lead_id uuid references public.leads (id),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_last10 text generated always as (right(phone_e164, 10)) stored,
  direction public.wa_direction not null,
  kind text not null check (kind in ('template', 'text', 'button_reply', 'media', 'manual', 'other')),
  template_id uuid references public.wa_templates (id),
  purpose text check (length(purpose) <= 40),
  body text check (length(body) <= 4096),
  vars jsonb not null default '[]'::jsonb check (jsonb_typeof(vars) = 'array'),
  wa_message_id text unique,
  status public.wa_status not null,
  status_rank smallint not null default 0,
  status_at timestamptz not null default now(),
  error_code text check (length(error_code) <= 40),
  error_text text check (length(error_text) <= 1000),
  category public.template_category,
  est_cost_paise integer not null default 0 check (est_cost_paise >= 0),
  respect_quiet boolean not null default false,
  scheduled_for timestamptz not null default now(),
  attempts smallint not null default 0,
  locked_until timestamptz,
  sent_by uuid references public.staff (id),
  appointment_id uuid references public.appointments (id),
  drip_send_id uuid,                         -- FK below
  dedupe_key text unique check (length(dedupe_key) <= 200),
  context_wa_id text,                        -- inbound: the message it answers
  action text check (action in ('confirmed', 'reschedule', 'stop', 'start')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index wa_messages_patient on public.wa_messages (patient_id, created_at desc, id) where patient_id is not null;
create index wa_messages_lead on public.wa_messages (lead_id, created_at desc, id) where lead_id is not null;
create index wa_messages_phone on public.wa_messages (phone_last10, created_at desc);
create index wa_messages_queue on public.wa_messages (scheduled_for) where status = 'queued';
create index wa_messages_created on public.wa_messages using brin (created_at);
create trigger wa_messages_touch before update on public.wa_messages
  for each row execute function private.touch_updated();

create table public.wa_webhook_events (
  id bigint generated always as identity primary key,
  event_key text not null unique check (length(event_key) <= 300),
  kind text not null check (kind in ('status', 'message', 'other')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text check (length(error) <= 1000),
  payload jsonb
);
create index wa_webhook_events_recent on public.wa_webhook_events (received_at desc);

create table public.drip_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 500),
  trigger text not null default 'manual' check (trigger in (
    'manual', 'lead_created', 'consultation_done', 'treatment_started', 'treatment_completed', 'discharged')),
  audience text not null default 'patient' check (audience in ('patient', 'lead')),
  stop_on_reply boolean not null default true,
  stop_on_booking boolean not null default true,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (audience = 'lead' or trigger <> 'lead_created'),
  check (audience = 'patient' or trigger in ('manual', 'lead_created'))
);
create trigger drip_campaigns_touch before update on public.drip_campaigns
  for each row execute function private.touch_updated();
create trigger drip_campaigns_audit after insert or update or delete on public.drip_campaigns
  for each row execute function private.audit_row();

create table public.drip_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.drip_campaigns (id) on delete cascade,
  seq smallint not null check (seq between 1 and 50),
  template_id uuid not null references public.wa_templates (id),
  -- After the anchor (the enrolment or the event that started it).
  offset_minutes integer not null check (offset_minutes between 0 and 525600),
  unique (campaign_id, seq)
);

create table public.drip_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.drip_campaigns (id),
  patient_id uuid references public.patients (id),
  lead_id uuid references public.leads (id),
  anchor_at timestamptz not null default now(),
  status public.drip_status not null default 'active',
  next_seq smallint not null default 1,
  next_send_at timestamptz,
  stopped_reason text check (length(stopped_reason) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (patient_id is not null or lead_id is not null)
);
create unique index drip_enrollments_one_open on public.drip_enrollments (campaign_id, coalesce(patient_id, lead_id))
  where status in ('active', 'paused');
create index drip_enrollments_due on public.drip_enrollments (next_send_at) where status = 'active';
create index drip_enrollments_patient on public.drip_enrollments (patient_id) where patient_id is not null;
create index drip_enrollments_lead on public.drip_enrollments (lead_id) where lead_id is not null;
create trigger drip_enrollments_touch before update on public.drip_enrollments
  for each row execute function private.touch_updated();

create table public.drip_sends (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.drip_enrollments (id) on delete cascade,
  step_id uuid not null references public.drip_steps (id) on delete cascade,
  message_id uuid references public.wa_messages (id),
  created_at timestamptz not null default now(),
  unique (enrollment_id, step_id)   -- a step is sent once, whatever runs twice
);
alter table public.wa_messages add constraint wa_messages_drip_send_fk foreign key (drip_send_id) references public.drip_sends (id);

-- WhatsApp messages show in a lead's history.
alter table public.lead_activities drop constraint lead_activities_kind_check;
alter table public.lead_activities add constraint lead_activities_kind_check check (kind in (
  'created', 'note', 'stage', 'call', 'assigned', 'amount', 'edit', 'linked', 'duplicate', 'appointment', 'enquired_again',
  'deleted', 'whatsapp', 'whatsapp_in'));

------------------------------------------------------------------------------
-- Row level security. The apps read through RPCs (wa_thread, …); admins may read the tables.
------------------------------------------------------------------------------
alter table public.wa_templates enable row level security;
alter table public.wa_contacts enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_webhook_events enable row level security;
alter table public.drip_campaigns enable row level security;
alter table public.drip_steps enable row level security;
alter table public.drip_enrollments enable row level security;
alter table public.drip_sends enable row level security;

create policy wa_templates_select on public.wa_templates for select to authenticated
  using ((select private.my_role()) in ('receptionist', 'sales_executive', 'sales_manager', 'admin'));
create policy wa_contacts_select on public.wa_contacts for select to authenticated
  using ((select private.my_role()) in ('receptionist', 'sales_executive', 'sales_manager', 'admin'));
create policy wa_messages_select on public.wa_messages for select to authenticated
  using ((select private.my_role()) = 'admin');
create policy wa_webhook_events_select on public.wa_webhook_events for select to authenticated
  using ((select private.my_role()) = 'admin');
create policy drip_campaigns_select on public.drip_campaigns for select to authenticated
  using ((select private.my_role()) in ('receptionist', 'sales_manager', 'admin'));
create policy drip_steps_select on public.drip_steps for select to authenticated
  using ((select private.my_role()) in ('receptionist', 'sales_manager', 'admin'));
create policy drip_enrollments_select on public.drip_enrollments for select to authenticated
  using ((select private.my_role()) in ('receptionist', 'sales_manager', 'admin'));
create policy drip_sends_select on public.drip_sends for select to authenticated
  using ((select private.my_role()) = 'admin');

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
create function private.wa_setting(p_key text, p_default jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.setting('whatsapp', p_key, p_default);
$$;

-- Quiet hours (IST), e.g. 21:00 → 09:00 across midnight.
create function private.wa_is_quiet(p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start time := (private.wa_setting('quiet_start', '"21:00"') #>> '{}')::time;
  v_end time := (private.wa_setting('quiet_end', '"09:00"') #>> '{}')::time;
  v_now time := (private.ist(p_at))::time;
begin
  if v_start = v_end then
    return false;
  elsif v_start > v_end then
    return v_now >= v_start or v_now < v_end;
  end if;
  return v_now >= v_start and v_now < v_end;
end;
$$;

-- The next moment outside quiet hours (IST).
create function private.wa_after_quiet(p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_end time := (private.wa_setting('quiet_end', '"09:00"') #>> '{}')::time;
  v_day date := (private.ist(p_at))::date;
  v_at timestamptz;
begin
  if not private.wa_is_quiet(p_at) then
    return p_at;
  end if;
  v_at := private.ist_at(v_day, v_end);
  if v_at <= p_at then
    v_at := private.ist_at(v_day + 1, v_end);
  end if;
  return v_at;
end;
$$;

-- Where a message to a patient or lead goes, and whether automatic messages are allowed.
create function private.wa_target(p_patient uuid, p_lead uuid)
returns table (phone_e164 text, name text, wa_mode text, consent boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.whatsapp_e164, p.phone_e164), p.full_name, p.wa_mode,
         coalesce((p.consents -> 'whatsapp' ->> 'given')::boolean, false)
  from public.patients p where p.id = p_patient and p_patient is not null and p.merged_into_id is null
  union all
  select l.phone_e164, l.name, l.wa_mode, true
  from public.leads l where p_patient is null and l.id = p_lead and l.deleted_at is null
  limit 1;
$$;

-- {{n}} values for a template, from its variable map. Unknown or empty values become "-"
-- (Meta refuses empty parameters).
create function private.wa_resolve_vars(p_map jsonb, p_patient uuid, p_lead uuid, p_appointment uuid)
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
  v_appt record;
begin
  select t.name into v_name from private.wa_target(p_patient, p_lead) t;
  select * into v_clinic from public.clinic_settings where branch_code = 'main';
  if p_appointment is not null then
    select a.slot_start, coalesce(d.display_name, d.full_name) as doctor into v_appt
    from public.appointments a left join public.doctors d on d.id = a.doctor_id where a.id = p_appointment;
  end if;
  for v_key in select jsonb_array_elements_text(coalesce(p_map, '[]'::jsonb)) loop
    v_val := case v_key
      when 'name' then v_name
      when 'first_name' then split_part(coalesce(v_name, ''), ' ', 1)
      when 'clinic_name' then v_clinic.name
      when 'clinic_phone' then v_clinic.phones[1]
      when 'appt_date' then to_char(private.ist(v_appt.slot_start), 'DD/MM/YYYY')
      when 'appt_time' then ltrim(to_char(private.ist(v_appt.slot_start), 'HH12:MI AM'), '0')
      when 'doctor' then v_appt.doctor
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

-- Queues one outgoing message (the single path for staff sends, reminders, confirmations and
-- drips). Returns the row, or null when it is skipped (no number, opted out, manual mode for
-- automatic messages, no usable template). p:
--   {patient_id?, lead_id?, appointment_id?, purpose?, template_id?, text?, auto (bool),
--    scheduled_for?, dedupe_key?, drip_send_id?, id?}
create function private.wa_enqueue(p jsonb)
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
  if v_auto and (v_t.wa_mode = 'manual' or not coalesce((private.wa_setting('enabled', 'false'))::boolean, false)) then
    return null;
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

-- Calls an Edge Function from the database (pg_net), with the shared cron secret kept in
-- Vault by `pnpm supabase:configure`. Without those secrets it does nothing (logged).
create function private.call_edge(p_fn text, p_body jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'edge_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'edge_cron_secret';
  if v_url is null or v_secret is null then
    insert into public.job_runs (job, finished_at, ok, detail)
    values ('call_edge:' || p_fn, now(), false, jsonb_build_object('error', 'edge_base_url / edge_cron_secret not in Vault'));
    return;
  end if;
  perform net.http_post(
    url := v_url || '/' || p_fn,
    body := coalesce(p_body, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 10000);
end;
$$;

------------------------------------------------------------------------------
-- Staff: send, thread, manual fallback, opt-out
------------------------------------------------------------------------------
-- Who may message whom: reception/admin patients; sales their leads (managers all leads).
create function private.wa_can_message(p_patient uuid, p_lead uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_patient is not null then
    if not private.has_role('receptionist', 'admin') then
      perform private.fail('not_allowed');
    end if;
  elsif p_lead is not null then
    if not (private.has_role('sales_manager', 'admin')
            or exists (select 1 from public.leads l where l.id = p_lead and l.assigned_to = private.my_staff_id())) then
      perform private.fail('not_allowed');
    end if;
  else
    perform private.fail('invalid_input', 'target');
  end if;
end;
$$;

-- p: {patient_id | lead_id, template_id | text}. Returns the queued message; the web then asks
-- wa-dispatch to send it now (the 5-minute dispatcher would anyway).
create function public.wa_send(p jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := (p ->> 'patient_id')::uuid;
  v_lead uuid := (p ->> 'lead_id')::uuid;
  v_t record;
  v_contact public.wa_contacts;
  v_row public.wa_messages;
  v_text text := nullif(btrim(p ->> 'text'), '');
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  perform private.wa_can_message(v_patient, v_lead);
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  select * into v_row from public.wa_messages where id = p_client_id;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('repeat', true);
  end if;
  if not coalesce((private.wa_setting('enabled', 'false'))::boolean, false) then
    perform private.fail('whatsapp_off');
  end if;
  select * into v_t from private.wa_target(v_patient, v_lead);
  if v_t.phone_e164 is null then
    perform private.fail('invalid_input', 'phone');
  end if;
  select * into v_contact from public.wa_contacts where phone_e164 = v_t.phone_e164;
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
  elsif nullif(p ->> 'template_id', '') is null then
    perform private.fail('invalid_input', 'template');
  end if;
  v_row := private.wa_enqueue(jsonb_build_object('id', p_client_id, 'patient_id', v_patient, 'lead_id', v_lead,
                                                 'template_id', p ->> 'template_id', 'text', v_text, 'auto', false));
  if v_row.id is null then
    perform private.fail('invalid_input', 'template');
  end if;
  if v_lead is not null then
    perform private.lead_log(v_lead, 'whatsapp', coalesce(v_text, v_row.body), jsonb_build_object('message_id', v_row.id));
    update public.leads set last_activity_at = now() where id = v_lead;
  end if;
  return to_jsonb(v_row) || jsonb_build_object('repeat', false);
exception
  when invalid_text_representation then
    perform private.fail('invalid_input');
end;
$$;

-- No API (or the person's number is set to manual): log it and hand back a wa.me message.
create function public.wa_prepare_manual(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := (p ->> 'patient_id')::uuid;
  v_lead uuid := (p ->> 'lead_id')::uuid;
  v_t record;
  v_text text := nullif(btrim(p ->> 'text'), '');
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  perform private.wa_can_message(v_patient, v_lead);
  if v_text is null or length(v_text) > 4096 then
    perform private.fail('invalid_input', 'text');
  end if;
  select * into v_t from private.wa_target(v_patient, v_lead);
  if v_t.phone_e164 is null then
    perform private.fail('invalid_input', 'phone');
  end if;
  insert into public.wa_messages (patient_id, lead_id, phone_e164, direction, kind, body, status, status_rank, sent_by)
  values (v_patient, case when v_patient is null then v_lead end, v_t.phone_e164, 'outbound', 'manual', v_text, 'manual', 1,
          private.my_staff_id());
  return jsonb_build_object('phone_e164', v_t.phone_e164, 'text', v_text);
end;
$$;

-- Messages with a patient or lead, newest first (keyset), plus the number's state.
create function public.wa_thread(p_patient_id uuid default null, p_lead_id uuid default null,
                                 p_cursor text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_t record;
  v_contact public.wa_contacts;
  v_rows jsonb;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  perform private.wa_can_message(p_patient_id, p_lead_id);
  select * into v_t from private.wa_target(p_patient_id, p_lead_id);
  select * into v_contact from public.wa_contacts where phone_e164 = v_t.phone_e164;
  select coalesce(jsonb_agg(x.card order by x.created_at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object('id', m.id, 'direction', m.direction, 'kind', m.kind, 'body', m.body, 'vars', m.vars,
             'status', m.status, 'status_at', m.status_at, 'error_text', m.error_text, 'created_at', m.created_at,
             'template', tp.name, 'sent_by_name', s.full_name, 'action', m.action) as card, m.created_at, m.id
    from public.wa_messages m
    left join public.wa_templates tp on tp.id = m.template_id
    left join public.staff s on s.id = m.sent_by
    where ((p_patient_id is not null and m.patient_id = p_patient_id)
           or (p_lead_id is not null and m.lead_id = p_lead_id)
           or (v_t.phone_e164 is not null and m.phone_last10 = right(v_t.phone_e164, 10) and m.patient_id is null and m.lead_id is null))
      and (v_c is null or (m.created_at, m.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by m.created_at desc, m.id desc
    limit v_limit + 1) x;
  return jsonb_build_object(
    'phone_e164', v_t.phone_e164,
    'wa_mode', v_t.wa_mode,
    'enabled', coalesce((private.wa_setting('enabled', 'false'))::boolean, false),
    'opted_out', v_contact.opted_out_at is not null,
    'window_open_until', case when v_contact.last_inbound_at > now() - interval '24 hours'
                              then v_contact.last_inbound_at + interval '24 hours' end,
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'created_at', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

-- The person asked (in person or by phone) to stop or restart WhatsApp messages.
create function public.wa_set_opt_out(p_patient_id uuid, p_lead_id uuid, p_out boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  perform private.wa_can_message(p_patient_id, p_lead_id);
  select * into v_t from private.wa_target(p_patient_id, p_lead_id);
  if v_t.phone_e164 is null then
    perform private.fail('invalid_input', 'phone');
  end if;
  insert into public.wa_contacts (phone_e164, opted_out_at, opt_out_source)
  values (v_t.phone_e164, case when p_out then now() end, case when p_out then 'staff' end)
  on conflict (phone_e164) do update
    set opted_out_at = case when p_out then coalesce(public.wa_contacts.opted_out_at, now()) end,
        opt_out_source = case when p_out then coalesce(public.wa_contacts.opt_out_source, 'staff') end,
        updated_at = now();
  if p_out then
    perform private.drip_stop_for_phone(v_t.phone_e164, 'opted out');
  end if;
  return jsonb_build_object('opted_out', p_out);
end;
$$;

------------------------------------------------------------------------------
-- Drips
------------------------------------------------------------------------------
create function private.drip_stop_for_phone(p_phone text, p_reason text)
returns integer
language sql
security definer
set search_path = ''
as $$
  with stopped as (
    update public.drip_enrollments e set status = 'stopped', stopped_reason = p_reason, next_send_at = null
    where e.status in ('active', 'paused')
      and (e.patient_id in (select id from public.patients where right(coalesce(whatsapp_e164, phone_e164), 10) = right(p_phone, 10))
           or e.lead_id in (select id from public.leads where phone_last10 = right(p_phone, 10)))
    returning 1)
  select count(*)::integer from stopped;
$$;

-- When the next step is due: anchor + the step's offset (never in the past), or null when done.
create function private.drip_next_at(p_campaign uuid, p_seq smallint, p_anchor timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(p_anchor + make_interval(mins => s.offset_minutes), now())
  from public.drip_steps s where s.campaign_id = p_campaign and s.seq = p_seq;
$$;

create function private.drip_enroll_one(p_campaign uuid, p_patient uuid, p_lead uuid, p_anchor timestamptz)
returns public.drip_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drip_enrollments;
  v_first smallint;
begin
  select min(seq) into v_first from public.drip_steps where campaign_id = p_campaign;
  if v_first is null then
    return null;
  end if;
  insert into public.drip_enrollments (campaign_id, patient_id, lead_id, anchor_at, next_seq, next_send_at)
  values (p_campaign, p_patient, case when p_patient is null then p_lead end, coalesce(p_anchor, now()), v_first,
          private.drip_next_at(p_campaign, v_first, coalesce(p_anchor, now())))
  on conflict do nothing
  returning * into v_row;
  return v_row;
end;
$$;

-- Event → every active campaign with that trigger.
create function private.drip_auto_enroll(p_trigger text, p_patient uuid, p_lead uuid, p_anchor timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.drip_enroll_one(c.id, p_patient, p_lead, p_anchor)
  from public.drip_campaigns c
  where c.active and c.trigger = p_trigger
    and ((c.audience = 'patient' and p_patient is not null) or (c.audience = 'lead' and p_lead is not null));
$$;

create function public.drip_enroll(p_campaign_id uuid, p_patient_id uuid default null, p_lead_id uuid default null,
                                   p_anchor_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.drip_campaigns;
  v_row public.drip_enrollments;
begin
  perform private.require_staff(array['receptionist', 'sales_manager', 'admin']::public.staff_role[]);
  select * into v_c from public.drip_campaigns where id = p_campaign_id and active;
  if not found then
    perform private.fail('not_found', 'campaign');
  end if;
  if (v_c.audience = 'patient' and p_patient_id is null) or (v_c.audience = 'lead' and p_lead_id is null) then
    perform private.fail('invalid_input', 'target');
  end if;
  perform private.wa_can_message(case when v_c.audience = 'patient' then p_patient_id end,
                                 case when v_c.audience = 'lead' then p_lead_id end);
  v_row := private.drip_enroll_one(p_campaign_id, case when v_c.audience = 'patient' then p_patient_id end,
                                   case when v_c.audience = 'lead' then p_lead_id end, p_anchor_at);
  if v_row.id is null then
    perform private.fail('duplicate', 'already enrolled');
  end if;
  return to_jsonb(v_row);
end;
$$;

create function public.drip_set_status(p_enrollment_id uuid, p_status public.drip_status)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drip_enrollments;
begin
  perform private.require_staff(array['receptionist', 'sales_manager', 'admin']::public.staff_role[]);
  if p_status not in ('active', 'paused', 'stopped') then
    perform private.fail('invalid_input', 'status');
  end if;
  update public.drip_enrollments e set
    status = p_status,
    stopped_reason = case when p_status = 'stopped' then 'stopped by staff' end,
    next_send_at = case when p_status = 'active' then greatest(coalesce(e.next_send_at, now()), now())
                        when p_status = 'stopped' then null else e.next_send_at end
  where e.id = p_enrollment_id and e.status in ('active', 'paused')
  returning * into v_row;
  if v_row.id is null then
    perform private.fail('invalid_status_change');
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Due drip steps → queued messages. One runner at a time (advisory lock); a step can be sent
-- only once per enrolment (drip_sends unique), so two runners can't double-send.
create function public.wa_drip_due(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e record;
  v_step public.drip_steps;
  v_send public.drip_sends;
  v_msg public.wa_messages;
  v_next smallint;
  v_n integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('drip_runner', 10)) then
    return 0;
  end if;
  for v_e in
    select e.* from public.drip_enrollments e join public.drip_campaigns c on c.id = e.campaign_id
    where e.status = 'active' and e.next_send_at <= now() and c.active
    order by e.next_send_at limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update of e skip locked
  loop
    select * into v_step from public.drip_steps where campaign_id = v_e.campaign_id and seq = v_e.next_seq;
    if v_step.id is not null then
      insert into public.drip_sends (enrollment_id, step_id) values (v_e.id, v_step.id)
      on conflict do nothing returning * into v_send;
      if v_send.id is not null then
        v_msg := private.wa_enqueue(jsonb_build_object('patient_id', v_e.patient_id, 'lead_id', v_e.lead_id,
                   'template_id', v_step.template_id, 'auto', true, 'purpose', 'drip', 'drip_send_id', v_send.id,
                   'dedupe_key', 'drip:' || v_send.id));
        update public.drip_sends set message_id = v_msg.id where id = v_send.id;
        v_n := v_n + 1;
      end if;
    end if;
    select min(seq) into v_next from public.drip_steps where campaign_id = v_e.campaign_id and seq > v_e.next_seq;
    update public.drip_enrollments set
      next_seq = coalesce(v_next, next_seq),
      next_send_at = case when v_next is null then null else private.drip_next_at(v_e.campaign_id, v_next, v_e.anchor_at) end,
      status = case when v_next is null then 'completed'::public.drip_status else status end
    where id = v_e.id;
  end loop;
  return v_n;
end;
$$;

------------------------------------------------------------------------------
-- Automatic messages: booking confirmation, reminders
------------------------------------------------------------------------------
-- Reminders N hours before (Settings → Appointments, default 24), once per booking.
create function public.wa_due_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer := coalesce((private.setting('appointments', 'reminder_hours_before', '24'))::int, 24);
  v_n integer := 0;
  v_a record;
begin
  if not coalesce((private.wa_setting('enabled', 'false'))::boolean, false)
     or not coalesce((private.wa_setting('send_reminders', 'true'))::boolean, true) or v_hours <= 0 then
    return 0;
  end if;
  for v_a in
    select a.id, a.patient_id, a.lead_id from public.appointments a
    where a.status in ('pending_confirmation', 'confirmed') and a.slot_start > now()
      and a.slot_start <= now() + make_interval(hours => v_hours) and not a.is_walk_in
      and not exists (select 1 from public.wa_messages m where m.dedupe_key = 'reminder:' || a.id)
    order by a.slot_start limit 500
  loop
    if (private.wa_enqueue(jsonb_build_object('patient_id', v_a.patient_id, 'lead_id', v_a.lead_id, 'appointment_id', v_a.id,
          'purpose', 'appointment_reminder', 'auto', true, 'dedupe_key', 'reminder:' || v_a.id))).id is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

create function private.wa_on_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('pending_confirmation', 'confirmed') and not new.is_walk_in and new.slot_start > now()
       and coalesce((private.wa_setting('send_booking_confirmation', 'true'))::boolean, true) then
      perform private.wa_enqueue(jsonb_build_object('patient_id', new.patient_id, 'lead_id', new.lead_id,
        'appointment_id', new.id, 'purpose', 'appointment_booked', 'auto', true, 'dedupe_key', 'booked:' || new.id));
    end if;
    -- Drips that stop when the person books.
    update public.drip_enrollments e set status = 'stopped', stopped_reason = 'booked', next_send_at = null
    from public.drip_campaigns c
    where c.id = e.campaign_id and c.stop_on_booking and e.status in ('active', 'paused')
      and ((new.patient_id is not null and e.patient_id = new.patient_id) or (new.lead_id is not null and e.lead_id = new.lead_id));
  elsif new.status = 'done' and old.status is distinct from 'done' and new.type = 'consultation' and new.patient_id is not null then
    perform private.drip_auto_enroll('consultation_done', new.patient_id, null, now());
  end if;
  return null;
end;
$$;
create trigger appointments_whatsapp after insert or update of status on public.appointments
  for each row execute function private.wa_on_appointment();

create function private.wa_on_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.wa_enqueue(jsonb_build_object('lead_id', new.id, 'purpose', 'lead_welcome', 'auto', true,
                                                'dedupe_key', 'welcome:' || new.id));
  perform private.drip_auto_enroll('lead_created', null, new.id, now());
  return null;
end;
$$;
create trigger leads_whatsapp after insert on public.leads
  for each row execute function private.wa_on_lead();

create function private.wa_on_treatment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status <> 'cancelled' then
    perform private.drip_auto_enroll('treatment_started', new.patient_id, null, now());
  elsif tg_op = 'UPDATE' and new.status = 'completed' and old.status is distinct from 'completed' then
    perform private.drip_auto_enroll('treatment_completed', new.patient_id, null, now());
  end if;
  return null;
end;
$$;
create trigger patient_treatments_whatsapp after insert or update of status on public.patient_treatments
  for each row execute function private.wa_on_treatment();

create function private.wa_on_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'discharged' and old.status is distinct from 'discharged' then
    perform private.drip_auto_enroll('discharged', new.patient_id, null, coalesce(new.discharged_at, now()));
  end if;
  return null;
end;
$$;
create trigger admissions_whatsapp after update of status on public.admissions
  for each row execute function private.wa_on_admission();

------------------------------------------------------------------------------
-- The Edge Functions' side (service role only)
------------------------------------------------------------------------------
-- Takes up to p_limit queued messages that are due, for sending now. Automatic ones wait
-- outside quiet hours; opted-out numbers are dropped. Rows are held for 2 minutes so two
-- dispatchers never send the same message.
create function public.wa_claim_batch(p_limit integer default 20, p_now timestamptz default now())
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
  for v_m in
    select m.* from public.wa_messages m
    where m.status = 'queued' and m.scheduled_for <= p_now and (m.locked_until is null or m.locked_until < p_now)
    order by m.scheduled_for, m.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  loop
    update public.wa_messages set locked_until = p_now + interval '2 minutes', attempts = attempts + 1 where id = v_m.id;
    v_out := v_out || jsonb_build_object(
      'id', v_m.id, 'to', v_m.phone_e164, 'kind', v_m.kind, 'text', v_m.body, 'vars', v_m.vars,
      'template', (select jsonb_build_object('name', t.name, 'language', t.language, 'components', t.components)
                   from public.wa_templates t where t.id = v_m.template_id));
  end loop;
  return v_out;
end;
$$;

-- After Meta answered: sent (with its id), or failed (retried up to 5 times when temporary).
create function public.wa_mark_result(p_id uuid, p_wa_message_id text, p_error_code text default null,
                                      p_error_text text default null, p_retry boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.wa_messages;
begin
  select * into v_row from public.wa_messages where id = p_id for update;
  if not found or v_row.status <> 'queued' then
    return;
  end if;
  if p_wa_message_id is not null then
    update public.wa_messages set status = 'sent', status_rank = 1, wa_message_id = p_wa_message_id, status_at = now(),
                                  locked_until = null, error_code = null, error_text = null
    where id = p_id;
    perform private.bump_usage('wa_sent');
    perform private.bump_usage('wa_' || coalesce(v_row.category::text, 'session'));
    perform private.bump_usage('wa_cost_paise', v_row.est_cost_paise);
  elsif p_retry and v_row.attempts < 5 then
    update public.wa_messages set locked_until = null, error_code = left(p_error_code, 40), error_text = left(p_error_text, 1000),
                                  scheduled_for = now() + make_interval(mins => 5 * v_row.attempts)
    where id = p_id;
  else
    update public.wa_messages set status = 'failed', status_rank = 2, status_at = now(), locked_until = null,
                                  error_code = left(p_error_code, 40), error_text = left(p_error_text, 1000)
    where id = p_id;
  end if;
end;
$$;

-- A webhook event seen before is ignored (true = new, process it).
create function public.wa_webhook_seen(p_key text, p_kind text, p_payload jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.wa_webhook_events (event_key, kind, payload) values (left(p_key, 300), p_kind, p_payload)
  on conflict (event_key) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

create function public.wa_status_update(p_wa_message_id text, p_status public.wa_status, p_at timestamptz default null,
                                        p_error_code text default null, p_error_text text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.wa_messages set status = p_status, status_rank = private.wa_status_rank(p_status),
                                status_at = coalesce(p_at, now()),
                                error_code = case when p_status = 'failed' then left(p_error_code, 40) else error_code end,
                                error_text = case when p_status = 'failed' then left(p_error_text, 1000) else error_text end
  where wa_message_id = p_wa_message_id and status_rank < private.wa_status_rank(p_status);
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- An incoming message. p: {wa_message_id, from (E.164), kind, text, at, context_wa_id,
-- action: confirm | reschedule | stop | start | null}. Returns what was done.
create function public.wa_inbound(p jsonb)
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
      and a.slot_start > v_at and a.status in ('pending_confirmation', 'confirmed')
    order by a.slot_start limit 1
    for update;
    if v_appt.id is not null and v_action = 'confirm' and v_appt.status = 'pending_confirmation' then
      update public.appointments set status = 'confirmed', confirmed_via = 'whatsapp', confirmed_at = now(), version = version + 1
      where id = v_appt.id;
      update public.followups set status = 'done', done_at = now(), outcome = 'confirmed on WhatsApp'
      where kind = 'call_to_confirm' and ref_table = 'appointments' and ref_id = v_appt.id and status = 'open';
      v_done := 'confirmed';
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
  end if;
  return jsonb_build_object('status', 'new', 'action', v_done, 'appointment_id', v_appt.id, 'patient_id', v_patient, 'lead_id', v_lead);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input');
end;
$$;

-- Approved templates from Meta (wa-templates-sync). Purposes and variable maps set in the CRM are kept.
create function public.wa_templates_upsert(p_templates jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t jsonb;
  v_n integer := 0;
begin
  if jsonb_typeof(p_templates) <> 'array' or jsonb_array_length(p_templates) > 500 then
    perform private.fail('invalid_input', 'templates');
  end if;
  for v_t in select value from jsonb_array_elements(p_templates) loop
    insert into public.wa_templates (meta_id, name, language, category, status, components, body_text, param_count, synced_at)
    values (v_t ->> 'id', v_t ->> 'name', coalesce(v_t ->> 'language', 'en'),
            lower(coalesce(v_t ->> 'category', 'utility'))::public.template_category, coalesce(v_t ->> 'status', 'APPROVED'),
            coalesce(v_t -> 'components', '[]'::jsonb), left(v_t ->> 'body_text', 2000),
            least(coalesce((v_t ->> 'param_count')::int, 0), 20), now())
    on conflict (name, language) do update set
      meta_id = excluded.meta_id, category = excluded.category, status = excluded.status, components = excluded.components,
      body_text = excluded.body_text, param_count = excluded.param_count, synced_at = now();
    v_n := v_n + 1;
  end loop;
  -- Templates Meta no longer has stop being offered.
  update public.wa_templates set active = false
  where synced_at < now() - interval '1 minute' and meta_id is not null and active
    and meta_id not in (select value ->> 'id' from jsonb_array_elements(p_templates));
  return v_n;
end;
$$;

create function public.wa_integration_state(p_state text, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.integration_status (integration, state, last_ok_at, last_error, checked_at)
  values ('whatsapp', p_state, case when p_state = 'ok' then now() end, left(p_error, 1000), now())
  on conflict (integration) do update set
    state = excluded.state,
    last_ok_at = coalesce(excluded.last_ok_at, public.integration_status.last_ok_at),
    last_error = excluded.last_error,
    checked_at = now();
$$;

revoke execute on function
  public.wa_claim_batch(integer, timestamptz), public.wa_mark_result(uuid, text, text, text, boolean),
  public.wa_webhook_seen(text, text, jsonb), public.wa_status_update(text, public.wa_status, timestamptz, text, text),
  public.wa_inbound(jsonb), public.wa_templates_upsert(jsonb), public.wa_integration_state(text, text),
  public.wa_due_reminders(), public.wa_drip_due(integer)
from public, anon, authenticated;
grant execute on function
  public.wa_claim_batch(integer, timestamptz), public.wa_mark_result(uuid, text, text, text, boolean),
  public.wa_webhook_seen(text, text, jsonb), public.wa_status_update(text, public.wa_status, timestamptz, text, text),
  public.wa_inbound(jsonb), public.wa_templates_upsert(jsonb), public.wa_integration_state(text, text),
  public.wa_due_reminders(), public.wa_drip_due(integer)
to service_role;

------------------------------------------------------------------------------
-- Admin
------------------------------------------------------------------------------
-- p: {purpose?, variable_map?, active?}
create function public.wa_template_update(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.wa_templates;
  v_bad text;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if p_patch ? 'variable_map' then
    select k into v_bad from jsonb_array_elements_text(coalesce(p_patch -> 'variable_map', '[]'::jsonb)) k
    where k not in ('name', 'first_name', 'clinic_name', 'clinic_phone', 'appt_date', 'appt_time', 'doctor', 'uhid', 'treatment')
    limit 1;
    if v_bad is not null then
      perform private.fail('invalid_input', 'variable_map');
    end if;
  end if;
  update public.wa_templates t set
    purpose = case when p_patch ? 'purpose' then nullif(p_patch ->> 'purpose', '') else t.purpose end,
    variable_map = case when p_patch ? 'variable_map' then coalesce(p_patch -> 'variable_map', '[]'::jsonb) else t.variable_map end,
    active = case when p_patch ? 'active' then coalesce((p_patch ->> 'active')::boolean, true) else t.active end
  where t.id = p_id
  returning * into v_row;
  if v_row.id is null then
    perform private.fail('not_found');
  end if;
  if jsonb_array_length(v_row.variable_map) <> v_row.param_count and v_row.param_count > 0 then
    perform private.fail('invalid_input', 'variable_map');
  end if;
  return to_jsonb(v_row);
exception
  when unique_violation then
    perform private.fail('duplicate', 'purpose');
  when check_violation then
    perform private.fail('invalid_input', 'purpose');
end;
$$;

-- p: {id?, name, description, trigger, audience, stop_on_reply, stop_on_booking, active, version?,
--     steps: [{template_id, offset_minutes}]} (steps in order; seq = position)
create function public.drip_campaign_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  v_old public.drip_campaigns;
  v_step jsonb;
  v_seq smallint := 0;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  if jsonb_typeof(p -> 'steps') <> 'array' or jsonb_array_length(p -> 'steps') = 0 or jsonb_array_length(p -> 'steps') > 50 then
    perform private.fail('invalid_input', 'steps');
  end if;
  select * into v_old from public.drip_campaigns where id = v_id for update;
  if v_old.id is not null and v_old.version <> coalesce((p ->> 'version')::int, -1) then
    perform private.fail('stale_version');
  end if;
  insert into public.drip_campaigns (id, name, description, trigger, audience, stop_on_reply, stop_on_booking, active)
  values (v_id, btrim(p ->> 'name'), nullif(btrim(p ->> 'description'), ''), coalesce(p ->> 'trigger', 'manual'),
          coalesce(p ->> 'audience', 'patient'), coalesce((p ->> 'stop_on_reply')::boolean, true),
          coalesce((p ->> 'stop_on_booking')::boolean, true), coalesce((p ->> 'active')::boolean, true))
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, trigger = excluded.trigger, audience = excluded.audience,
    stop_on_reply = excluded.stop_on_reply, stop_on_booking = excluded.stop_on_booking, active = excluded.active,
    version = public.drip_campaigns.version + 1;
  -- Steps: keep the ones already sent (by seq), replace the rest.
  for v_step in select value from jsonb_array_elements(p -> 'steps') loop
    v_seq := v_seq + 1;
    if not exists (select 1 from public.wa_templates where id = (v_step ->> 'template_id')::uuid and active) then
      perform private.fail('invalid_input', 'steps.' || (v_seq - 1) || '.template_id');
    end if;
    insert into public.drip_steps (campaign_id, seq, template_id, offset_minutes)
    values (v_id, v_seq, (v_step ->> 'template_id')::uuid, (v_step ->> 'offset_minutes')::int)
    on conflict (campaign_id, seq) do update set template_id = excluded.template_id, offset_minutes = excluded.offset_minutes;
  end loop;
  delete from public.drip_steps s where s.campaign_id = v_id and s.seq > v_seq
    and not exists (select 1 from public.drip_sends d where d.step_id = s.id);
  return to_jsonb((select c from public.drip_campaigns c where c.id = v_id));
exception
  when unique_violation then
    perform private.fail('duplicate', 'name');
  when check_violation or invalid_text_representation or not_null_violation then
    perform private.fail('invalid_input');
end;
$$;

create function public.drip_campaigns_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'sales_manager', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object(
             'steps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'template_id', s.template_id,
                                                                     'template', t.name, 'offset_minutes', s.offset_minutes)
                                                  order by s.seq)
                                from public.drip_steps s join public.wa_templates t on t.id = s.template_id
                                where s.campaign_id = c.id), '[]'::jsonb),
             'active_enrollments', (select count(*) from public.drip_enrollments e where e.campaign_id = c.id and e.status = 'active'),
             'completed_enrollments', (select count(*) from public.drip_enrollments e where e.campaign_id = c.id and e.status = 'completed'))
           order by c.name)
    from public.drip_campaigns c), '[]'::jsonb);
end;
$$;

-- A person's drips (patient file / lead page).
create function public.drip_enrollments_for(p_patient_id uuid default null, p_lead_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'sales_manager', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'campaign', c.name, 'status', e.status, 'next_send_at', e.next_send_at,
                                        'stopped_reason', e.stopped_reason, 'created_at', e.created_at,
                                        'sent', (select count(*) from public.drip_sends d where d.enrollment_id = e.id),
                                        'steps', (select count(*) from public.drip_steps s where s.campaign_id = c.id))
                     order by e.created_at desc)
    from public.drip_enrollments e join public.drip_campaigns c on c.id = e.campaign_id
    where (p_patient_id is not null and e.patient_id = p_patient_id) or (p_lead_id is not null and e.lead_id = p_lead_id)), '[]'::jsonb);
end;
$$;

-- Admin → WhatsApp: connection state, this month's numbers and cost, queue.
create function public.wa_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month timestamptz := private.ist_at(date_trunc('month', private.ist(now()))::date, '00:00');
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  return jsonb_build_object(
    'integration', (select to_jsonb(i) from public.integration_status i where i.integration = 'whatsapp'),
    'month', (select jsonb_build_object(
               'sent', count(*) filter (where status_rank >= 1 and status <> 'manual' and status <> 'failed'),
               'delivered', count(*) filter (where status in ('delivered', 'read')),
               'read', count(*) filter (where status = 'read'),
               'failed', count(*) filter (where status = 'failed'),
               'manual', count(*) filter (where status = 'manual'),
               'cost_paise', coalesce(sum(est_cost_paise) filter (where status in ('sent', 'delivered', 'read')), 0))
             from public.wa_messages where direction = 'outbound' and created_at >= v_month),
    'received', (select count(*) from public.wa_messages where direction = 'inbound' and created_at >= v_month),
    'queued', (select count(*) from public.wa_messages where status = 'queued'),
    'opted_out', (select count(*) from public.wa_contacts where opted_out_at is not null),
    'last_dispatch', (select max(started_at) from public.job_runs where job = 'wa-dispatch'),
    'failures', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'phone_e164', m.phone_e164, 'error_text', m.error_text, 'at', m.status_at,
                                          'purpose', m.purpose) order by m.status_at desc)
      from (select * from public.wa_messages where status = 'failed' order by status_at desc limit 10) m), '[]'::jsonb));
end;
$$;

-- Edge Functions log each dispatch run here (for "last run" on the admin page).
create function public.wa_log_run(p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.job_runs (job, finished_at, ok, detail) values ('wa-dispatch', now(), true, coalesce(p_detail, '{}'::jsonb));
$$;
revoke execute on function public.wa_log_run(jsonb) from public, anon, authenticated;
grant execute on function public.wa_log_run(jsonb) to service_role;

------------------------------------------------------------------------------
-- Schedules (pg_cron runs in UTC)
------------------------------------------------------------------------------
select cron.schedule('wa-dispatch', '*/5 * * * *', $$select private.call_edge('wa-dispatch', '{"source":"cron"}')$$);
-- 02:15 IST: raw webhook payloads are kept 14 days (PLAN.md D5 housekeeping).
select cron.schedule('wa-housekeeping', '45 20 * * *',
  $$update public.wa_webhook_events set payload = null where payload is not null and received_at < now() - interval '14 days'$$);

select private.lock_down_public_functions();
