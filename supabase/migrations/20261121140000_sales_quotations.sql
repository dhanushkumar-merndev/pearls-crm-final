-- Owner 20/11/2026: "sales person can add quotation and send one click in their own WhatsApp",
-- "one press share quotation, it opens that user with the file attached", and "follow-up: can we
-- reschedule the existing one, not only after a call?".
--
--   * public.lead_quotations: treatments from the price list (price editable), a discount, a total,
--     valid till and a note. Saving one also sets the lead's "Quoted" amount. The WhatsApp text is
--     made here once, so the website and the phone send the same words; the phone builds the PDF
--     from the same row (clinic details come from clinic_settings, never hard-coded).
--   * mark_quotation_sent: the salesperson pressed Share / WhatsApp (their own WhatsApp, free; it
--     does not use the template budget). Logged on the lead's history.
--   * set_lead_next_call: move (or clear) the lead's one open follow-up without logging a call.
--     The phone queues it offline, so "not in the past" is checked against when it was chosen.

------------------------------------------------------------------------------
-- ₹ with Indian grouping: 15000000 paise → '₹1,50,000.00' (same as packages/shared money.ts)
------------------------------------------------------------------------------
create function private.inr(p_paise bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_paise < 0 then '-' else '' end || '₹' ||
    case when length(r) > 3
      then regexp_replace(left(r, length(r) - 3), '(\d)(?=(\d{2})+$)', '\1,', 'g') || ',' || right(r, 3)
      else r end
    || '.' || lpad((abs(p_paise) % 100)::text, 2, '0')
  from (select (abs(p_paise) / 100)::text as r) x;
$$;

------------------------------------------------------------------------------
-- Table
------------------------------------------------------------------------------
create table public.lead_quotations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  quote_no integer not null check (quote_no >= 1),
  -- [{treatment_id?, name, qty, price_paise}] — price_paise is for one; line = qty × price.
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0 and discount_paise <= subtotal_paise),
  total_paise bigint not null check (total_paise = subtotal_paise - discount_paise),
  valid_until date,
  note text check (length(note) <= 500),
  message text not null check (length(message) <= 4000),
  sent_count integer not null default 0 check (sent_count >= 0),
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id) default private.my_staff_id(),
  unique (lead_id, quote_no)
);
create index lead_quotations_lead on public.lead_quotations (lead_id, created_at desc);

alter table public.lead_quotations enable row level security;
grant select on public.lead_quotations to authenticated;
-- Same people as the lead itself: managers and admins, or the lead's owner.
create policy lead_quotations_select on public.lead_quotations for select to authenticated
  using (
    (select private.has_role('sales_manager', 'admin'))
    or exists (select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select private.my_staff_id()))
  );

alter table public.lead_activities drop constraint lead_activities_kind_check;
alter table public.lead_activities add constraint lead_activities_kind_check check (kind in (
  'created', 'note', 'stage', 'call', 'assigned', 'amount', 'edit', 'linked', 'duplicate', 'appointment', 'enquired_again',
  'deleted', 'whatsapp', 'whatsapp_in', 'quotation'));

------------------------------------------------------------------------------
-- What the screens and the PDF need: the quotation, the lead, the clinic and who made it.
------------------------------------------------------------------------------
create function private.quotation_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(q) || jsonb_build_object(
    'lead_name', l.name,
    'lead_phone', l.phone_e164,
    'lead_sl_no', l.sl_no,
    'created_by_name', s.full_name,
    'clinic', (select jsonb_build_object('name', c.name, 'legal_name', c.legal_name, 'gstin', c.gstin,
                                         'address_lines', to_jsonb(c.address_lines), 'city', c.city, 'state', c.state,
                                         'pincode', c.pincode, 'phones', to_jsonb(c.phones), 'email', c.email,
                                         'website', c.website, 'logo_path', c.logo_path)
               from public.clinic_settings c order by c.branch_code = 'main' desc, c.created_at limit 1))
  from public.lead_quotations q
  join public.leads l on l.id = q.lead_id
  left join public.staff s on s.id = q.created_by
  where q.id = p_id;
$$;

------------------------------------------------------------------------------
-- Save
------------------------------------------------------------------------------
create function public.save_lead_quotation(p_lead_id uuid, p_quote jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_lead public.leads;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_name text;
  v_qty integer;
  v_price bigint;
  v_sub bigint := 0;
  v_discount bigint := coalesce((p_quote ->> 'discount_paise')::bigint, 0);
  v_valid date := nullif(p_quote ->> 'valid_until', '')::date;
  v_note text := nullif(btrim(p_quote ->> 'note'), '');
  v_clinic public.clinic_settings;
  v_lines text := '';
  v_msg text;
  v_no integer;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client_id');
  end if;
  if exists (select 1 from public.lead_quotations where id = p_client_id) then
    return private.quotation_json(p_client_id);
  end if;
  v_lead := private.lead_for(p_lead_id, true);
  if jsonb_typeof(p_quote -> 'items') is distinct from 'array'
     or jsonb_array_length(p_quote -> 'items') not between 1 and 20 then
    perform private.fail('invalid_input', 'items');
  end if;
  for v_item in select e from jsonb_array_elements(p_quote -> 'items') e loop
    v_name := btrim(v_item ->> 'name');
    v_qty := coalesce((v_item ->> 'qty')::integer, 1);
    v_price := (v_item ->> 'price_paise')::bigint;
    if v_name is null or length(v_name) not between 1 and 200 or v_qty not between 1 and 100
       or v_price is null or v_price not between 0 and 10000000000 then
      perform private.fail('invalid_input', 'items');
    end if;
    if (v_item ->> 'treatment_id') is not null
       and not exists (select 1 from public.treatment_templates t where t.id = (v_item ->> 'treatment_id')::uuid) then
      perform private.fail('invalid_input', 'treatment_id');
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'treatment_id', v_item ->> 'treatment_id', 'name', v_name, 'qty', v_qty, 'price_paise', v_price));
    v_sub := v_sub + v_qty * v_price;
    v_lines := v_lines || E'\n• ' || v_name || case when v_qty > 1 then ' × ' || v_qty else '' end
               || ' — ' || private.inr(v_qty * v_price);
  end loop;
  if v_discount < 0 or v_discount > v_sub then
    perform private.fail('invalid_input', 'discount_paise');
  end if;
  if v_valid is not null and v_valid < (private.ist(now()))::date then
    perform private.fail('invalid_input', 'valid_until');
  end if;
  if length(v_note) > 500 then
    perform private.fail('invalid_input', 'note');
  end if;

  select * into v_clinic from public.clinic_settings order by branch_code = 'main' desc, created_at limit 1;
  v_msg := 'Hello ' || split_part(v_lead.name, ' ', 1) || ',' || E'\n\n'
    || 'Here is your quotation from ' || coalesce(v_clinic.name, '') || ':' || v_lines
    || case when v_discount > 0 then E'\nDiscount — −' || private.inr(v_discount) else '' end
    || E'\n*Total — ' || private.inr(v_sub - v_discount) || '*'
    || case when v_valid is not null then E'\nValid till ' || to_char(v_valid, 'DD/MM/YYYY') else '' end
    || case when v_note is not null then E'\n\n' || v_note else '' end
    || case when cardinality(v_clinic.phones) > 0 then E'\n\nQuestions? Call ' || v_clinic.phones[1] || '.' else '' end;

  select coalesce(max(quote_no), 0) + 1 into v_no from public.lead_quotations where lead_id = p_lead_id;
  insert into public.lead_quotations (id, lead_id, quote_no, items, subtotal_paise, discount_paise, total_paise,
                                      valid_until, note, message, created_by)
  values (p_client_id, p_lead_id, v_no, v_items, v_sub, v_discount, v_sub - v_discount, v_valid, v_note, left(v_msg, 4000), v_staff);

  update public.leads set amount_quoted_paise = v_sub - v_discount, last_activity_at = now(), version = version + 1
   where id = p_lead_id;
  perform private.lead_log(p_lead_id, 'quotation', null,
    jsonb_build_object('quotation_id', p_client_id, 'quote_no', v_no, 'total_paise', v_sub - v_discount, 'event', 'created'));
  return private.quotation_json(p_client_id);
exception
  when invalid_text_representation or check_violation or invalid_datetime_format or numeric_value_out_of_range then
    perform private.fail('invalid_input');
end;
$$;

------------------------------------------------------------------------------
-- Read
------------------------------------------------------------------------------
create function public.lead_quotations_list(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  perform private.lead_for(p_lead_id);
  return coalesce((select jsonb_agg(private.quotation_json(q.id) order by q.quote_no desc)
                   from (select id, quote_no from public.lead_quotations where lead_id = p_lead_id
                         order by quote_no desc limit 50) q), '[]'::jsonb);
end;
$$;

create function public.lead_quotation(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  select lead_id into v_lead from public.lead_quotations where id = p_id;
  if v_lead is null then
    perform private.fail('not_found');
  end if;
  perform private.lead_for(v_lead);
  return private.quotation_json(p_id);
end;
$$;

------------------------------------------------------------------------------
-- Sent (the salesperson's own WhatsApp opened with the text or the PDF)
------------------------------------------------------------------------------
create function public.mark_quotation_sent(p_id uuid, p_via text default 'whatsapp')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q public.lead_quotations;
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  if p_via not in ('whatsapp', 'whatsapp_pdf', 'share') then
    perform private.fail('invalid_input', 'via');
  end if;
  select * into v_q from public.lead_quotations where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  perform private.lead_for(v_q.lead_id);
  update public.lead_quotations set sent_count = sent_count + 1, last_sent_at = now() where id = p_id;
  update public.leads set last_activity_at = now() where id = v_q.lead_id;
  perform private.lead_log(v_q.lead_id, 'quotation', null,
    jsonb_build_object('quotation_id', p_id, 'quote_no', v_q.quote_no, 'total_paise', v_q.total_paise, 'event', 'sent', 'via', p_via));
end;
$$;

------------------------------------------------------------------------------
-- Move the next call (follow-up) without logging a call
------------------------------------------------------------------------------
create function public.set_lead_next_call(p_id uuid, p_at timestamptz, p_chosen_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.leads;
  -- Chosen on a phone with no signal: judged against when it was chosen (never later than now).
  v_chosen timestamptz := least(coalesce(p_chosen_at, now()), now());
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_old := private.lead_for(p_id, true);
  if p_at is not null and p_at is distinct from v_old.next_followup_at and p_at < v_chosen - interval '5 minutes' then
    perform private.fail('followup_in_past', 'next_followup_at');
  end if;
  if p_at is not distinct from v_old.next_followup_at then
    return private.lead_card(p_id);
  end if;
  update public.leads set last_activity_at = now(), version = version + 1 where id = p_id;
  perform private.set_lead_followup(p_id, p_at);
  perform private.lead_log(p_id, 'edit', null, jsonb_build_object('fields', jsonb_build_array('next_followup_at')));
  return private.lead_card(p_id);
end;
$$;

------------------------------------------------------------------------------
-- Lead page bookings: what the Actions menu needs (confirm / reschedule / cancel / restore),
-- same as the Appointments page.
------------------------------------------------------------------------------
create or replace function public.lead_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_lead := private.lead_for(p_id);
  return private.lead_card(p_id) || jsonb_build_object(
    'patient', public.lead_patient_summary(p_id),
    'duplicates', private.lead_duplicates(v_lead.phone_e164, v_lead.alt_phone_e164, p_id),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'slot_start', a.slot_start, 'status', a.status, 'type', a.type,
                                          'mode', a.mode, 'version', a.version, 'doctor_id', a.doctor_id,
                                          'patient_id', a.patient_id, 'auto_cancelled', a.auto_cancelled_at is not null,
                                          'doctor', coalesce(d.display_name, d.full_name)) order by a.slot_start desc)
      from (select * from public.appointments a where a.lead_id = p_id and a.status <> 'rescheduled'
            order by a.slot_start desc nulls last limit 20) a
      left join public.doctors d on d.id = a.doctor_id), '[]'::jsonb),
    'followups', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'due_date', f.due_date, 'due_at', f.due_at,
                                          'reason', f.reason, 'assigned_to', f.assigned_to) order by f.due_date)
      from public.followups f where f.lead_id = p_id and f.status = 'open'), '[]'::jsonb),
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'started_at', c.started_at, 'direction', c.direction,
                                          'duration_s', c.duration_s, 'outcome', c.outcome, 'notes', c.notes,
                                          'staff_name', s.full_name) order by c.started_at desc)
      from (select * from public.call_logs c where c.lead_id = p_id order by c.started_at desc limit 10) c
      left join public.staff s on s.id = c.staff_id), '[]'::jsonb));
end;
$$;

select private.lock_down_public_functions();
