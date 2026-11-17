-- Phase 19c: the sales sheet (Priyanka's "Sales CRM – New Leads" sheet, 16/11/2026), on the web and
-- the phone. Columns: Patient name | Source | Phone | Sales team | Doctor | Consultation date & time |
-- Prescription (= the quotation: quoted → finalised) | Surgery date | Follow-up 1, 2, 3 | Remarks.
--   * private.lead_sheet_extra(lead): the consultation (the next upcoming booking, else the latest)
--     and the first three calls (follow-up 1, 2, 3) + how many calls in all.
--   * leads_sheet(filters, sort, desc, offset, limit): leads_table's rows (same filters, roles, order;
--     a sales executive sees only their own) plus those columns.
--   * lead_sheet_row(lead): one lead's row (the phone's lead page).

create index if not exists call_logs_lead_started on public.call_logs (lead_id, started_at) where lead_id is not null;
create index if not exists appointments_lead_slot on public.appointments (lead_id, slot_start) where lead_id is not null;

create function private.lead_sheet_extra(p_lead_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with l as (select id, patient_id from public.leads where id = p_lead_id),
  appts as (
    select a.* from public.appointments a, l
    where (a.lead_id = l.id or l.patient_id is not null and a.patient_id = l.patient_id)
      and a.status not in ('cancelled', 'rescheduled')
  ),
  consult as (
    (select * from appts where slot_start >= now() order by slot_start limit 1)
    union all
    (select * from appts where not exists (select 1 from appts where slot_start >= now()) order by slot_start desc limit 1)
  )
  select jsonb_build_object(
    'consult', (select jsonb_build_object('appointment_id', c.id, 'at', c.slot_start, 'date', c.appt_date, 'status', c.status,
                                          'doctor', coalesce(d.display_name, d.full_name))
                  from consult c left join public.doctors d on d.id = c.doctor_id limit 1),
    'followups', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.started_at, 'outcome', x.outcome, 'by', x.by_name, 'notes', x.notes) order by x.started_at)
      from (select cl.started_at, cl.outcome, cl.notes, s.full_name as by_name
              from public.call_logs cl left join public.staff s on s.id = cl.staff_id, l
             where cl.lead_id = l.id order by cl.started_at limit 3) x), '[]'::jsonb),
    'calls_total', (select count(*) from public.call_logs cl, l where cl.lead_id = l.id));
$$;

-- The sheet: leads_table (filters, role rules, order and paging) with the sheet's extra columns.
create function public.leads_sheet(p_filters jsonb default '{}', p_sort text default 'lead_date', p_desc boolean default true,
                                   p_offset integer default 0, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page jsonb;
begin
  perform private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_page := public.leads_table(p_filters, p_sort, p_desc, p_offset, p_limit);
  return jsonb_build_object(
    'total', v_page -> 'total',
    'rows', coalesce((
      select jsonb_agg(r.card || private.lead_sheet_extra((r.card ->> 'id')::uuid) order by r.o)
      from jsonb_array_elements(v_page -> 'rows') with ordinality r (card, o)), '[]'::jsonb));
end;
$$;

-- One lead's sheet row (the phone's lead page): a sales executive only for their own lead.
create function public.lead_sheet_row(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_staff(array['sales_executive', 'sales_manager', 'admin']::public.staff_role[]);
  v_l public.leads;
begin
  select * into v_l from public.leads where id = p_lead_id and deleted_at is null;
  if not found or (private.has_role('sales_executive') and v_l.assigned_to is distinct from v_me) then
    perform private.fail('not_found');
  end if;
  return jsonb_build_object(
    'id', v_l.id, 'sl_no', v_l.sl_no, 'name', v_l.name, 'phone_e164', v_l.phone_e164, 'version', v_l.version,
    'source_label', (select label from public.lookup_values where id = v_l.source_id),
    'assigned_name', (select full_name from public.staff where id = v_l.assigned_to),
    'doctor_name', (select coalesce(display_name, full_name) from public.doctors where id = v_l.doctor_id),
    'amount_quoted_paise', v_l.amount_quoted_paise, 'amount_finalised_paise', v_l.amount_finalised_paise,
    'amount_locked', exists (select 1 from public.patient_treatments t where t.lead_id = v_l.id and t.status <> 'cancelled'),
    'surgery_date', v_l.surgery_date, 'comments1', v_l.comments1, 'next_followup_at', v_l.next_followup_at,
    'stage', v_l.stage) || private.lead_sheet_extra(v_l.id);
end;
$$;

select private.lock_down_public_functions();
