-- Leads table: leads whose next call is overdue always come first (owner, 30/10/2026), in the chosen order
-- among themselves; then every other lead in the same order. "Overdue" is the same rule as the Next call filter
-- (next_followup_at < now()). The Sl No tie-break follows the chosen direction.
create or replace function public.leads_table(p_filters jsonb default '{}', p_sort text default 'lead_date', p_desc boolean default true,
                                   p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_only uuid := case when private.has_role('sales_executive') then v_me end;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  a record;
  v_order text := case p_sort
    when 'sl_no' then 'f.sl_no' when 'name' then 'lower(f.name)' when 'stage' then 'f.stage::text'
    when 'next_followup_at' then 'f.next_followup_at' when 'last_activity_at' then 'f.last_activity_at'
    when 'amount_finalised_paise' then 'f.amount_finalised_paise' when 'assigned' then 's.full_name'
    else 'f.lead_date' end;
  v_dir text := case when p_desc then 'desc' else 'asc' end;
  v_result jsonb;
begin
  select * into a from private.leads_filter_args(coalesce(p_filters, '{}'::jsonb));
  execute format($q$
    with f as (
      select * from private.leads_filtered($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', coalesce((
        select jsonb_agg(x.card order by x.ord)
        from (
          select to_jsonb(f) || jsonb_build_object(
                   'assigned_name', s.full_name, 'source_label', src.label, 'treatment', coalesce(tt.name, f.treatment_text),
                   'doctor_name', coalesce(d.display_name, d.full_name), 'lost_reason', lr.label, 'uhid', p.uhid,
                   'amount_locked', exists (select 1 from public.patient_treatments t where t.lead_id = f.id and t.status <> 'cancelled')) as card,
                 row_number() over (order by (f.next_followup_at < now()) is true desc, %1$s %2$s nulls last, f.sl_no %2$s) as ord
          from f
          left join public.staff s on s.id = f.assigned_to
          left join public.lookup_values src on src.id = f.source_id
          left join public.treatment_templates tt on tt.id = f.treatment_template_id
          left join public.doctors d on d.id = f.doctor_id
          left join public.lookup_values lr on lr.id = f.lost_reason_id
          left join public.patients p on p.id = f.patient_id
          order by (f.next_followup_at < now()) is true desc, %1$s %2$s nulls last, f.sl_no %2$s
          limit $13 offset $14) x), '[]'::jsonb))
  $q$, v_order, v_dir)
  into v_result
  using a.q, a.digits, a.stages, a.assignee, a.unassigned, a.sources, a.d_from, a.d_to, a.due, v_only, a.doctor, a.treatment,
        v_limit, greatest(coalesce(p_offset, 0), 0);
  return v_result;
end;
$$;

select private.lock_down_public_functions();
