-- The team inbox for a number that is neither a patient nor a lead (e.g. a chat-bot chat):
-- the whole conversation, not just the last message, and "read" when someone opens it.
-- Same visibility as wa_threads rows with no patient/lead: reception and admin.

create function public.wa_number_thread(p_phone text, p_cursor text default null, p_limit integer default 30)
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
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.fail('invalid_input');
  end if;
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
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(v_rows -> (v_limit - 1) ->> 'created_at', v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

create function public.wa_number_mark_read(p_phone text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  update public.wa_threads set unread_count = 0, read_at = now(), updated_at = now()
  where phone_e164 = p_phone and patient_id is null and lead_id is null and unread_count > 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.wa_number_thread(text, text, integer) from public, anon;
revoke execute on function public.wa_number_mark_read(text) from public, anon;
grant execute on function public.wa_number_thread(text, text, integer) to authenticated;
grant execute on function public.wa_number_mark_read(text) to authenticated;
