-- Reply from the inbox to a number that is neither a patient nor a lead (e.g. after the chat
-- bot): free text inside Meta's 24-hour window, an approved template after it. The thread now
-- carries the window and opt-out state, like wa_thread. Reception and admin, as the inbox.

create or replace function public.wa_number_thread(p_phone text, p_cursor text default null, p_limit integer default 30)
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
  v_contact public.wa_contacts;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.fail('invalid_input');
  end if;
  select * into v_contact from public.wa_contacts where phone_e164 = p_phone;
  select coalesce(jsonb_agg(x.card order by x.created_at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object('id', m.id, 'direction', m.direction, 'kind', m.kind, 'body', m.body, 'vars', m.vars,
             'status', m.status, 'status_at', m.status_at, 'error_text', m.error_text, 'created_at', m.created_at,
             'template', tp.name, 'sent_by_name', s.full_name, 'action', m.action) as card, m.created_at, m.id
    from public.wa_messages m
    left join public.wa_templates tp on tp.id = m.template_id
    left join public.staff s on s.id = m.sent_by
    where m.phone_last10 = right(p_phone, 10) and m.patient_id is null and m.lead_id is null
      and (v_c is null or (m.created_at, m.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by m.created_at desc, m.id desc
    limit v_limit + 1) x;
  return jsonb_build_object(
    'phone_e164', p_phone,
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

create function public.wa_number_send(p_phone text, p jsonb, p_client_id uuid)
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
    v_cost := case v_tpl.category
      when 'marketing' then coalesce((private.wa_setting('cost_marketing_paise', '88'))::int, 88)
      else coalesce((private.wa_setting('cost_utility_paise', '12'))::int, 12) end;
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

revoke execute on function public.wa_number_send(text, jsonb, uuid) from public, anon;
grant execute on function public.wa_number_send(text, jsonb, uuid) to authenticated;
