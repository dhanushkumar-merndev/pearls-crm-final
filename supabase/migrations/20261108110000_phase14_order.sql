-- Sales targets: a stable order when two salespeople share a name (name, then id), so the
-- table doesn't reshuffle between refreshes.
create or replace function public.sales_targets_month(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, (private.ist(now()))::date)::timestamp)::date;
begin
  perform private.require_staff(array['admin', 'sales_manager']::public.staff_role[]);
  return jsonb_build_object(
    'month', v_month,
    'enabled', (private.setting('sales', 'targets_enabled', 'false'))::boolean,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.full_name, 'role', s.role)
                       || private.sales_target_progress(s.id, v_month) order by s.full_name, s.id)
      from public.staff s where s.active and s.role in ('sales_executive', 'sales_manager')), '[]'::jsonb));
end;
$$;

select private.lock_down_public_functions();
