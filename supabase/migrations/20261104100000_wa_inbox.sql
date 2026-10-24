-- Pearl CRM — WhatsApp team inbox and live updates (Phase 10 follow-up, owner 24/10/2026:
-- "3–5 people will chat, I need it mostly real time").
-- wa_threads: one row per WhatsApp number — the latest message, how many replies nobody has
-- read yet, and whose it is (patient or lead). Kept current by a trigger on wa_messages, so a
-- reply or a delivery tick updates it, and Realtime tells every open screen allowed to see it.
-- Rows carry the same visibility as messaging: reception/admin see patients and unknown
-- numbers, sales managers/admin see leads, a sales executive sees only their own leads.

create table public.wa_threads (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  patient_id uuid references public.patients (id),
  lead_id uuid references public.leads (id),
  last_message_at timestamptz not null,
  last_preview text check (length(last_preview) <= 200),
  last_direction public.wa_direction not null,
  last_status public.wa_status not null,
  -- Replies received since someone in the team last opened the conversation.
  unread_count integer not null default 0 check (unread_count >= 0),
  read_at timestamptz,
  updated_at timestamptz not null default now()
);
create index wa_threads_recent on public.wa_threads (last_message_at desc, phone_e164);
create index wa_threads_unread on public.wa_threads (last_message_at desc) where unread_count > 0;
create index wa_threads_lead on public.wa_threads (lead_id) where lead_id is not null;

alter table public.wa_threads enable row level security;
grant select on public.wa_threads to authenticated;

-- Who may see a conversation (the same rule as private.wa_can_message, without raising).
create function private.wa_thread_visible(p_patient uuid, p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.has_role('admin') then true
    when p_patient is not null or p_lead is null then private.has_role('receptionist')
    when private.has_role('sales_manager') then true
    else exists (select 1 from public.leads l where l.id = p_lead and l.assigned_to = private.my_staff_id() and l.deleted_at is null)
  end;
$$;

-- An RLS helper, so signed-in users may call it (it reveals only a yes/no for ids they pass).
grant execute on function private.wa_thread_visible(uuid, uuid) to authenticated;

create policy wa_threads_select on public.wa_threads for select to authenticated
  using ((select private.wa_thread_visible(patient_id, lead_id)));

alter publication supabase_realtime add table public.wa_threads;

create function private.wa_threads_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.wa_threads as t (phone_e164, patient_id, lead_id, last_message_at, last_preview, last_direction,
                                        last_status, unread_count)
    values (new.phone_e164, new.patient_id, new.lead_id, new.created_at, left(coalesce(new.body, ''), 200), new.direction,
            new.status, case when new.direction = 'inbound' then 1 else 0 end)
    on conflict (phone_e164) do update set
      patient_id = coalesce(excluded.patient_id, t.patient_id),
      lead_id = coalesce(excluded.lead_id, t.lead_id),
      last_message_at = greatest(t.last_message_at, excluded.last_message_at),
      last_preview = case when excluded.last_message_at >= t.last_message_at then excluded.last_preview else t.last_preview end,
      last_direction = case when excluded.last_message_at >= t.last_message_at then excluded.last_direction else t.last_direction end,
      last_status = case when excluded.last_message_at >= t.last_message_at then excluded.last_status else t.last_status end,
      unread_count = t.unread_count + excluded.unread_count,
      updated_at = now();
  elsif new.status is distinct from old.status then
    -- A delivery tick: refresh the row so open screens reload (and show it on the latest message).
    update public.wa_threads t set
      last_status = case when t.last_message_at = new.created_at then new.status else t.last_status end,
      updated_at = now()
    where t.phone_e164 = new.phone_e164;
  end if;
  return null;
end;
$$;

create trigger wa_messages_threads after insert or update of status on public.wa_messages
  for each row execute function private.wa_threads_touch();

-- Conversations already on the project.
insert into public.wa_threads (phone_e164, patient_id, lead_id, last_message_at, last_preview, last_direction, last_status,
                               unread_count)
select distinct on (m.phone_e164) m.phone_e164,
       (select x.patient_id from public.wa_messages x where x.phone_e164 = m.phone_e164 and x.patient_id is not null
         order by x.created_at desc limit 1),
       (select x.lead_id from public.wa_messages x where x.phone_e164 = m.phone_e164 and x.lead_id is not null
         order by x.created_at desc limit 1),
       m.created_at, left(coalesce(m.body, ''), 200), m.direction, m.status, 0
from public.wa_messages m
order by m.phone_e164, m.created_at desc
on conflict do nothing;

-- The inbox: newest conversation first (keyset), optionally only those with unread replies.
create function public.wa_inbox(p_unread_only boolean default false, p_cursor text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  select coalesce(jsonb_agg(x.card order by x.last_message_at desc, x.phone_e164 desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'phone_e164', t.phone_e164, 'patient_id', t.patient_id, 'lead_id', t.lead_id,
             'name', coalesce(p.full_name, l.name), 'uhid', p.uhid, 'sl_no', l.sl_no,
             'last_message_at', t.last_message_at, 'last_preview', t.last_preview, 'last_direction', t.last_direction,
             'last_status', t.last_status, 'unread_count', t.unread_count) as card,
           t.last_message_at, t.phone_e164
    from public.wa_threads t
    left join public.patients p on p.id = t.patient_id
    left join public.leads l on l.id = t.lead_id and t.patient_id is null
    where private.wa_thread_visible(t.patient_id, t.lead_id)
      and (not coalesce(p_unread_only, false) or t.unread_count > 0)
      and (v_c is null or (t.last_message_at, t.phone_e164) < ((v_c ->> 0)::timestamptz, v_c ->> 1))
    order by t.last_message_at desc, t.phone_e164 desc
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'last_message_at', v_rows -> (v_limit - 1) ->> 'phone_e164')::text end);
exception
  when invalid_text_representation or invalid_datetime_format then
    perform private.fail('invalid_input', 'cursor');
end;
$$;

-- Someone opened the conversation: its replies count as read for the whole team.
create function public.wa_mark_read(p_patient_id uuid default null, p_lead_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_n integer;
begin
  perform private.require_staff(array['receptionist', 'sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  perform private.wa_can_message(p_patient_id, p_lead_id);
  select t.phone_e164 into v_phone from private.wa_target(p_patient_id, p_lead_id) t;
  update public.wa_threads set unread_count = 0, read_at = now(), updated_at = now()
  where phone_e164 = v_phone and unread_count > 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Menu badges: + conversations with unread WhatsApp replies.
create or replace function public.nav_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff();
  v_role public.staff_role := private.my_role();
  v_out jsonb := '{}'::jsonb;
begin
  if v_role in ('receptionist', 'admin') then
    v_out := v_out || jsonb_build_object('pharmacy', (select count(*) from public.stock_alerts where cleared_at is null));
  end if;
  if v_role in ('sales_manager', 'admin') then
    v_out := v_out || jsonb_build_object('leads', (select count(*) from public.leads
                                                   where deleted_at is null and assigned_to is null
                                                     and stage not in ('converted', 'lost', 'junk')));
  elsif v_role = 'sales_executive' then
    v_out := v_out || jsonb_build_object('leads', (select count(*) from public.leads
                                                   where assigned_to = v_me and deleted_at is null
                                                     and next_followup_at < now()));
  end if;
  if v_role in ('receptionist', 'sales_executive', 'sales_manager', 'admin') then
    v_out := v_out || jsonb_build_object('whatsapp', (select count(*) from public.wa_threads t
                                                      where t.unread_count > 0 and private.wa_thread_visible(t.patient_id, t.lead_id)));
  end if;
  return v_out;
end;
$$;

select private.lock_down_public_functions();
