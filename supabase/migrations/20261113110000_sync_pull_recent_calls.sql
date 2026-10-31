-- Phone sync (31/10/2026, `pnpm perf`): the first pull of call logs walked every call the
-- person ever made in updated order and dropped those older than 60 days (2,372 of 2,573 rows
-- read for one executive on the two-year perf seed), so it grew with the clinic's history.
-- Same function as in 20261101100000_phase9_leads.sql except for the call-log condition.
create or replace function public.sync_pull(p_since jsonb default '{}', p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'bdm', 'admin']::public.staff_role[]);
  v_role public.staff_role := private.my_role();
  v_all boolean := v_role in ('sales_manager', 'admin');
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_since jsonb := coalesce(p_since, '{}'::jsonb);
  v_entities text[] := case when v_role = 'bdm' then array['leads', 'lookup_values']
                            else array['leads', 'followups', 'appointments', 'call_logs', 'crm_numbers', 'lookup_values'] end;
  v_entity text;
  v_marker text;
  v_at timestamptz;
  v_id uuid;
  v_rows jsonb;
  v_removed jsonb;
  v_out jsonb := '{}'::jsonb;
  v_from_day date := (private.ist(now()))::date - 60;
begin
  if jsonb_typeof(v_since) <> 'object' then
    perform private.fail('invalid_input', 'since');
  end if;
  foreach v_entity in array v_entities loop
    continue when not v_since ? v_entity;
    v_marker := nullif(v_since ->> v_entity, '');
    begin
      v_at := coalesce(split_part(v_marker, '|', 1)::timestamptz, '-infinity');
      v_id := coalesce(nullif(split_part(v_marker, '|', 2), '')::uuid, '00000000-0000-0000-0000-000000000000');
    exception when others then
      perform private.fail('invalid_input', 'marker ' || v_entity);
    end;
    v_rows := null;
    v_removed := '[]'::jsonb;

    if v_entity in ('leads', 'crm_numbers') then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select case
                 when v_entity = 'crm_numbers' then jsonb_build_object('id', l.id, 'lead_id', l.id, 'phone_last10', l.phone_last10,
                   'alt_phone_last10', l.alt_phone_last10, 'patient_id', l.patient_id, 'updated_at', l.updated_at)
                 when v_role = 'bdm' then jsonb_build_object('id', l.id, 'sl_no', l.sl_no, 'name', l.name,
                   'phone_e164', l.phone_e164, 'stage', l.stage, 'lead_date', l.lead_date, 'created_at', l.created_at,
                   'updated_at', l.updated_at)
                 else to_jsonb(l) end as j,
               l.updated_at, l.id
        from public.leads l
        where l.deleted_at is null
          and (v_all or (v_role = 'bdm' and l.created_by = v_me) or (v_role = 'sales_executive' and l.assigned_to = v_me))
          and (l.updated_at, l.id) > (v_at, v_id)
        order by l.updated_at, l.id
        limit v_limit + 1) x;
      if v_at > '-infinity' then
        select coalesce(jsonb_agg(distinct r.id), '[]'::jsonb) into v_removed
        from (
          select a.lead_id as id from public.lead_assignments a join public.leads l on l.id = a.lead_id
          where v_role = 'sales_executive' and a.from_staff = v_me and a.at > v_at and l.assigned_to is distinct from v_me
          union all
          select l.id from public.leads l
          where l.deleted_at > v_at
            and (v_all or (v_role = 'bdm' and l.created_by = v_me) or (v_role = 'sales_executive' and l.assigned_to = v_me))
          limit 1000) r;
      end if;

    elsif v_entity = 'followups' then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select to_jsonb(f) as j, f.updated_at, f.id from public.followups f
        where f.assigned_to = v_me and (f.updated_at, f.id) > (v_at, v_id)
        union all
        select to_jsonb(f), f.updated_at, f.id from public.followups f
        where v_all and f.source = 'sales' and f.assigned_to is distinct from v_me and (f.updated_at, f.id) > (v_at, v_id)
        order by 2, 3
        limit v_limit + 1) x;

    elsif v_entity = 'appointments' then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select to_jsonb(a) || jsonb_build_object('doctor', coalesce(d.display_name, d.full_name)) as j, a.updated_at, a.id
        from public.appointments a left join public.doctors d on d.id = a.doctor_id
        where a.appt_date >= v_from_day and (a.updated_at, a.id) > (v_at, v_id)
          and ((v_all and a.lead_id is not null)
               or a.booked_by = v_me
               or a.lead_id in (select l.id from public.leads l where l.assigned_to = v_me and l.deleted_at is null))
        order by a.updated_at, a.id
        limit v_limit + 1) x;

    elsif v_entity = 'call_logs' then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select to_jsonb(c) as j, c.updated_at, c.id from public.call_logs c
        where (v_all or c.staff_id = v_me) and c.started_at >= now() - interval '60 days'
          -- A call's row is written after the call starts, so a row changed more than 61 days ago
          -- (a day's margin for a phone clock that is off) can't be a call of the last 60 days:
          -- the index can then skip the older calls instead of reading and dropping them.
          and c.updated_at >= now() - interval '61 days'
          and (c.updated_at, c.id) > (v_at, v_id)
        order by c.updated_at, c.id
        limit v_limit + 1) x;

    elsif v_entity = 'lookup_values' then
      select jsonb_agg(x.j order by x.updated_at, x.id) into v_rows
      from (
        select jsonb_build_object('id', v.id, 'kind', v.kind, 'label', v.label, 'code', v.code, 'sort', v.sort,
                                  'active', v.active and v.merged_into_id is null, 'usage_count', v.usage_count,
                                  'updated_at', v.updated_at) as j, v.updated_at, v.id
        from public.lookup_values v
        where v.kind in ('lead_source', 'lost_reason', 'referral_name', 'quick_reply', 'break_type')
          and (v.updated_at, v.id) > (v_at, v_id)
        order by v.updated_at, v.id
        limit v_limit + 1) x;
    end if;

    v_out := v_out || jsonb_build_object(v_entity, private.sync_page(v_rows, v_limit, v_at, v_id, v_removed));
  end loop;
  return jsonb_build_object('server_time', now(), 'entities', v_out);
end;
$$;

select private.lock_down_public_functions();
