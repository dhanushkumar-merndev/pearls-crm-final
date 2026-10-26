-- Phase 15: speed. Measured with `pnpm perf` (a two-year seed, rolled back): the admin dashboard took
-- 0.7 s for a year. Same results, cheaper plans.

-- Today's KPIs are worked out live by every dashboard. As a SQL function, the day's bounds were a
-- joined CTE the planner couldn't see through (~40 ms); as variables, the index ranges are exact (~5 ms).
create or replace function private.kpi_compute_day(p_day date)
returns table (metric text, dim_kind text, dim_id text, value numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lo constant timestamptz := private.ist_at(p_day, '00:00');
  v_hi constant timestamptz := private.ist_at(p_day + 1, '00:00');
begin
  return query
  with bills_day as (
      select b.* from public.bills b
      where b.status = 'finalized' and b.bill_at >= v_lo and b.bill_at < v_hi
    ),
    pay_day as (
      select p.* from public.payments p
      where p.cancelled_at is null and p.received_at >= v_lo and p.received_at < v_hi
    ),
    appt_day as (select a.* from public.appointments a where a.appt_date = p_day),
    pharmacy_lines as (
      select i.total_paise, i.taxable_paise, round(i.qty * coalesce(i.unit_cost_paise, 0)) as cogs
      from bills_day b join public.bill_items i on i.bill_id = b.id and i.kind = 'pharmacy'
    ),
    admitted_day as (
      select a.* from public.admissions a
      where a.status <> 'cancelled' and a.admitted_at >= v_lo and a.admitted_at < v_hi
    ),
    discharged_day as (
      select a.* from public.admissions a
      where a.status = 'discharged' and a.discharged_at >= v_lo and a.discharged_at < v_hi
    )
    select 'revenue_paise', 'clinic', '', coalesce(sum(total_paise), 0) from bills_day
    union all select 'revenue_paise', 'bill_type', bill_type::text, sum(total_paise) from bills_day group by bill_type
    union all select 'discount_paise', 'clinic', '', coalesce(sum(discount_paise), 0) from bills_day
    union all select 'tax_paise', 'clinic', '', coalesce(sum(cgst_paise + sgst_paise), 0) from bills_day
    union all select 'bills_count', 'bill_type', bill_type::text, count(*) from bills_day group by bill_type
    union all
    select 'revenue_paise', 'category', coalesce(c.code, c.id::text, 'none'), sum(i.total_paise)
    from bills_day b join public.bill_items i on i.bill_id = b.id and i.kind <> 'carried_in'
    left join public.lookup_values c on c.id = i.category_id
    group by coalesce(c.code, c.id::text, 'none')
    union all
    select 'revenue_paise', 'doctor', b.doctor_id::text, sum(b.total_paise) from bills_day b where b.doctor_id is not null group by b.doctor_id
    union all
    select 'collected_paise', 'clinic', '', coalesce(sum(amount_paise) filter (where kind <> 'refund'), 0) from pay_day
    union all
    select 'collected_paise', 'mode', coalesce(m.code, m.id::text), sum(p.amount_paise)
    from pay_day p join public.lookup_values m on m.id = p.mode_id where p.kind <> 'refund' group by coalesce(m.code, m.id::text)
    union all select 'refunds_paise', 'clinic', '', coalesce(sum(amount_paise) filter (where kind = 'refund'), 0) from pay_day
    union all select 'appointments_count', 'clinic', '', count(*) from appt_day where status not in ('cancelled', 'rescheduled')
    union all select 'appointments_count', 'doctor', doctor_id::text, count(*) from appt_day
                where status not in ('cancelled', 'rescheduled') and doctor_id is not null group by doctor_id
    union all select 'arrived_count', 'clinic', '', count(*) from appt_day where arrived_at is not null
    union all select 'no_show_count', 'clinic', '', count(*) from appt_day where status = 'no_show'
    union all select 'walk_in_count', 'clinic', '', count(*) from appt_day where is_walk_in and status not in ('cancelled', 'rescheduled')
    union all
    select 'new_patients', 'clinic', '', count(*) from public.patients p
    where p.created_at >= v_lo and p.created_at < v_hi and p.merged_into_id is null
    union all select 'pharmacy_sales_paise', 'clinic', '', coalesce(sum(total_paise), 0) from pharmacy_lines
    union all select 'pharmacy_taxable_paise', 'clinic', '', coalesce(sum(taxable_paise), 0) from pharmacy_lines
    union all select 'pharmacy_cogs_paise', 'clinic', '', coalesce(sum(cogs), 0) from pharmacy_lines
    union all select 'admissions_count', 'clinic', '', count(*) from admitted_day
    union all select 'discharges_count', 'clinic', '', count(*) from discharged_day
    union all select 'stay_days', 'clinic', '', coalesce(sum(private.room_days(admitted_at, discharged_at)), 0) from discharged_day;
end;
$$;

-- The admin dashboard in parts, so the page can ask for them side by side (one call for a year with its
-- comparison was ~0.6 s on the seed; each part is well under the 300 ms budget):
--   summary   kpis, trend, sessions, pharmacy_stock, bdm, storage, backup, integrations
--   previous  the same tiles for the period before (when p_compare)
--   money     outstanding, by_source, funnel, agreed_vs_billed, top_medicines
-- No parts = everything, as before.
drop function public.dashboard_admin(date, date, boolean);
create function public.dashboard_admin(p_from date, p_to date, p_compare boolean default true, p_parts text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
-- Planned for the actual dates on every call: a cached generic plan (after five calls) guessed the
-- date ranges and was up to 5× slower now and then.
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_days integer;
  v_bucket text;
  v_today date := (private.ist(now()))::date;
  v_lo timestamptz;
  v_hi timestamptz;
  v_parts text[] := coalesce(p_parts, array['summary', 'previous', 'money']);
  v jsonb;
begin
  perform private.require_staff(array['admin']::public.staff_role[]);
  perform private.check_range(p_from, p_to);
  if cardinality(v_parts) = 0 or not v_parts <@ array['summary', 'previous', 'money'] then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  v_days := p_to - p_from + 1;
  v_bucket := case when v_days <= 31 then 'day' when v_days <= 120 then 'week' else 'month' end;
  v_lo := private.ist_at(p_from, '00:00');
  v_hi := private.ist_at(p_to + 1, '00:00');
  v := jsonb_build_object('from', p_from, 'to', p_to, 'bucket', v_bucket);

  if 'summary' = any(v_parts) then
    v := v || jsonb_build_object(
      'kpis', private.admin_kpis(p_from, p_to),
      -- Revenue and collections per day / week / month (closed days from the rollup, today live).
      'trend', (
        with days as (
          select d.day, d.metric, d.value from public.kpi_daily d
          where d.day between p_from and least(p_to, v_today - 1) and d.dim_kind = 'clinic'
            and d.metric in ('revenue_paise', 'collected_paise')
          union all
          select v_today, c.metric, c.value from private.kpi_compute_day(v_today) c
          where v_today between p_from and p_to and c.dim_kind = 'clinic' and c.metric in ('revenue_paise', 'collected_paise')
        ), buckets as (
          select g::date as bucket from generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval) g
        )
        select jsonb_agg(jsonb_build_object(
                 'bucket', bk.bucket,
                 'revenue_paise', coalesce((select sum(x.value) from days x where x.metric = 'revenue_paise'
                                              and date_trunc(v_bucket, x.day::timestamp)::date = bk.bucket), 0),
                 'collected_paise', coalesce((select sum(x.value) from days x where x.metric = 'collected_paise'
                                                and date_trunc(v_bucket, x.day::timestamp)::date = bk.bucket), 0))
               order by bk.bucket)
        from buckets bk),
      -- Sessions planned in the range: on time (within 3 days), late, missed, overdue, upcoming.
      'sessions', (
        select jsonb_build_object(
          'on_time', count(*) filter (where s.status = 'done' and s.actual_date <= s.planned_date + 3),
          'late', count(*) filter (where s.status = 'done' and s.actual_date > s.planned_date + 3),
          'missed', count(*) filter (where s.status in ('missed', 'skipped')),
          'overdue', count(*) filter (where s.status in ('planned', 'booked') and s.planned_date < v_today),
          'upcoming', count(*) filter (where s.status in ('planned', 'booked') and s.planned_date >= v_today))
        from public.treatment_sessions s where s.planned_date between p_from and p_to),
      'pharmacy_stock', (
        select jsonb_build_object(
          'stock_value_paise', coalesce(sum(round(qty_on_hand * purchase_price_paise)) filter (where expiry_date >= v_today), 0),
          'near_expiry_value_paise', coalesce(sum(round(qty_on_hand * purchase_price_paise))
            filter (where expiry_date >= v_today and expiry_date <= v_today + 90), 0))
        from public.item_batches where qty_on_hand > 0),
      'bdm', jsonb_build_object(
        'on_duty', (select count(*) from public.bdm_days d where d.work_date = v_today and d.ended_at is null),
        'total', (select count(*) from public.staff s where s.role = 'bdm' and s.active),
        'people', coalesce((
          select jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.full_name, 'days', x.days, 'visits', x.visits,
                                              'leads', x.leads, 'km', round(x.metres / 1000.0, 1)) order by x.visits desc, s.full_name)
          from (
            select d.staff_id, count(*) as days,
                   sum((select count(*) from public.site_visits v where v.day_id = d.id and v.completed_at is not null)) as visits,
                   sum((select count(*) from public.site_visits v where v.day_id = d.id and v.lead_id is not null)) as leads,
                   sum(coalesce((coalesce(d.summary, private.bdm_day_summary(d.id)) ->> 'distance_m')::numeric, 0)) as metres
            from public.bdm_days d where d.work_date between p_from and p_to
            group by d.staff_id
          ) x join public.staff s on s.id = x.staff_id), '[]'::jsonb)),
      'storage', private.storage_usage(),
      'backup', jsonb_build_object(
        'last_files_at', (select max(i.verified_at) from public.backup_items i where i.file_id is not null),
        'last_export_at', (select max(b.finished_at) from public.backup_batches b where b.kind = 'database' and b.status = 'done')),
      'integrations', coalesce((
        select jsonb_agg(jsonb_build_object('integration', i.integration, 'state', i.state, 'last_ok_at', i.last_ok_at,
                                            'last_error', i.last_error, 'checked_at', i.checked_at) order by i.integration)
        from public.integration_status i), '[]'::jsonb));
  end if;

  if 'previous' = any(v_parts) then
    v := v || jsonb_build_object('previous', case when p_compare then
      private.admin_kpis(p_from - v_days, p_from - 1) - array['by_bill_type', 'by_category', 'by_mode', 'by_doctor'] end);
  end if;

  if 'money' = any(v_parts) then
    v := v || jsonb_build_object(
      -- Who owes money now, by the age of the oldest bill not yet covered by payments. One pass over
      -- bills and payments for the balances; the running sums (to find that bill) only for those who owe.
      'outstanding', (
        with owing as (
          select t.patient_id, sum(t.billed) - sum(t.paid) as due, sum(t.paid) as paid
          from (
            select b.patient_id, b.total_paise as billed, 0::bigint as paid
            from public.bills b where b.status = 'finalized'
            union all
            select p.patient_id, 0, case when p.kind = 'refund' then -p.amount_paise else p.amount_paise end
            from public.payments p where p.cancelled_at is null
          ) t
          group by t.patient_id
          having sum(t.billed) > 0 and sum(t.billed) - sum(t.paid) > 0
        ), aged as (
          select o.due, case when v_today - (private.ist(x.oldest))::date <= 30 then '0_30'
                             when v_today - (private.ist(x.oldest))::date <= 60 then '31_60'
                             when v_today - (private.ist(x.oldest))::date <= 90 then '61_90' else '90_plus' end as bucket
          from owing o
          cross join lateral (
            select min(rb.bill_at) as oldest
            from (select b.bill_at, sum(b.total_paise) over (order by b.bill_at, b.id) as running
                  from public.bills b where b.patient_id = o.patient_id and b.status = 'finalized') rb
            where rb.running > o.paid
          ) x
        )
        select jsonb_build_object(
          'total_paise', coalesce((select sum(due) from aged), 0),
          'patients', (select count(*) from aged),
          'ageing', (select jsonb_agg(jsonb_build_object('bucket', bk, 'paise', coalesce((select sum(a.due) from aged a where a.bucket = bk), 0),
                                                         'patients', (select count(*) from aged a where a.bucket = bk)) order by ord)
                     from unnest(array['0_30', '31_60', '61_90', '90_plus']) with ordinality u (bk, ord)))),
      -- Billed revenue by where the patient first came from: their own lead, else the first lead that
      -- converted into them. Per patient first; the leads are joined as sets, not looked up one by one.
      'by_source', coalesce((
        select jsonb_agg(jsonb_build_object('source_id', x.source_id, 'label', lv.label, 'paise', x.paise, 'patients', x.n)
                         order by x.paise desc)
        from (
          select case when own.id is not null then own.source_id else fl.source_id end as source_id,
                 sum(pb.paise) as paise, count(*) as n
          from (
            select b.patient_id, sum(b.total_paise) as paise
            from public.bills b
            where b.status = 'finalized' and b.bill_at >= v_lo and b.bill_at < v_hi
            group by b.patient_id
          ) pb
          join public.patients p on p.id = pb.patient_id
          left join public.leads own on own.id = p.lead_id and own.deleted_at is null
          left join (
            select distinct on (l.patient_id) l.patient_id, l.source_id
            from public.leads l where l.patient_id is not null and l.deleted_at is null
            order by l.patient_id, l.created_at
          ) fl on fl.patient_id = p.id
          group by 1
        ) x left join public.lookup_values lv on lv.id = x.source_id), '[]'::jsonb),
      'funnel', private.lead_funnel(p_from, p_to, null),
      'agreed_vs_billed', private.agreed_vs_billed(v_lo, v_hi),
      'top_medicines', coalesce((
        select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'name', it.name, 'qty', x.qty, 'paise', x.paise) order by x.paise desc)
        from (
          select i.pharmacy_item_id as item_id, sum(i.qty) as qty, sum(i.total_paise) as paise
          from public.bills b join public.bill_items i on i.bill_id = b.id and i.kind = 'pharmacy'
          where b.status = 'finalized' and b.bill_at >= v_lo and b.bill_at < v_hi
          group by i.pharmacy_item_id order by sum(i.total_paise) desc limit 10
        ) x left join public.pharmacy_items it on it.id = x.item_id), '[]'::jsonb));
  end if;
  return v;
end;
$$;
grant execute on function public.dashboard_admin(date, date, boolean, text[]) to authenticated;

select private.lock_down_public_functions();
