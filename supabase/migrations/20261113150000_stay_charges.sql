-- IP stay charges from the stay page (owner, 02/11/2026: "make it simple to add charges in IP stay").
-- "Add charge" puts one line on the stay's draft final bill, creating that draft on first use. The
-- final bill is where the stay's own charges belong (PLAN.md C6), so nothing is counted twice:
-- interim procedure / pharmacy bills still carry in as before. The stay page lists every charge of
-- the stay (all its bills, carried-in copies left out) with a running total.

-- A retried "Add charge" (same client id) adds nothing. save_bill re-inserts a draft's lines without
-- it, which is fine: a retry comes seconds after the first try.
alter table public.bill_items add column client_id uuid;
create unique index bill_items_client_id on public.bill_items (client_id) where client_id is not null;

-- p_line: {description, service_id?, category_id?, hsn_sac?, gst_rate_bp?, rate_paise, qty, service_date?, doctor_id?}
create function public.add_stay_charge(p_admission_id uuid, p_line jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_a public.admissions;
  v_bill public.bills;
  v_date date := coalesce(nullif(p_line ->> 'service_date', '')::date, (private.ist(now()))::date);
  v_rate bigint := (p_line ->> 'rate_paise')::bigint;
  v_qty numeric := coalesce((p_line ->> 'qty')::numeric, 1);
  v_service public.services;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  select * into v_a from public.admissions where id = p_admission_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if exists (select 1 from public.bill_items where client_id = p_client_id) then
    return private.admission_card(v_a.id);
  end if;
  if v_a.status = 'cancelled' then
    perform private.fail('invalid_status_change', 'admission cancelled');
  end if;
  if length(btrim(coalesce(p_line ->> 'description', ''))) = 0 then
    perform private.fail('invalid_input', 'description');
  end if;
  if v_rate is null or v_rate < 0 or v_rate > 10000000000 then
    perform private.fail('invalid_input', 'rate_paise');
  end if;
  if v_qty <= 0 or v_qty > 10000 then
    perform private.fail('invalid_quantity');
  end if;
  -- On a day of the stay (or after discharge, up to today: charges are often posted late).
  if v_date < (private.ist(v_a.admitted_at))::date or v_date > (private.ist(now()))::date then
    perform private.fail('invalid_input', 'service_date');
  end if;
  if nullif(p_line ->> 'service_id', '') is not null then
    select * into v_service from public.services where id = (p_line ->> 'service_id')::uuid;
    if not found then
      perform private.fail('invalid_input', 'service_id');
    end if;
  end if;

  -- A finalized final bill closes the stay's charges (an admin amends it instead).
  if exists (select 1 from public.bills where admission_id = v_a.id and bill_type = 'final_bill' and status = 'finalized') then
    perform private.fail('bill_locked');
  end if;
  select * into v_bill from public.bills
   where admission_id = v_a.id and bill_type = 'final_bill' and status = 'draft'
   order by created_at limit 1 for update;
  if not found then
    perform public.create_bill('final_bill', v_a.patient_id, jsonb_build_object('admission_id', v_a.id), gen_random_uuid());
    select * into v_bill from public.bills
     where admission_id = v_a.id and bill_type = 'final_bill' and status = 'draft'
     order by created_at limit 1 for update;
  end if;

  insert into public.bill_items (bill_id, line_no, category_id, kind, service_id, doctor_id, description, hsn_sac,
                                 service_date, rate_paise, qty, discount_type, discount_value, gst_rate_bp, client_id)
  values (v_bill.id,
          coalesce((select max(line_no) from public.bill_items where bill_id = v_bill.id), 0) + 1,
          coalesce(nullif(p_line ->> 'category_id', '')::uuid, v_service.category_id),
          case when v_service.id is null then 'custom' when v_service.is_doctor_charge then 'doctor_charge' else 'service' end,
          v_service.id,
          coalesce(nullif(p_line ->> 'doctor_id', '')::uuid, v_service.doctor_id),
          btrim(p_line ->> 'description'),
          coalesce(nullif(btrim(p_line ->> 'hsn_sac'), ''), v_service.sac),
          v_date, v_rate, v_qty, 'amount', 0,
          coalesce((p_line ->> 'gst_rate_bp')::int, v_service.gst_rate_bp, 0),
          p_client_id);
  -- An open editor of this bill must reload before saving over the new line.
  update public.bills set version = version + 1 where id = v_bill.id;
  perform private.recompute_bill(v_bill.id);
  return private.admission_card(v_a.id);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
       or check_violation or not_null_violation then
    perform private.fail('invalid_input');
end;
$$;

-- The stay page: same card as before plus every charge of the stay and their total.
create or replace function private.admission_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(a) || jsonb_build_object(
    'patient', p.full_name, 'uhid', p.uhid, 'gender', p.gender, 'age', private.age_years(p.dob),
    'treatment', t.name, 'room_type', r.name, 'room_rate_paise', r.daily_rate_paise,
    'room_days', private.room_days(a.admitted_at, coalesce(a.discharged_at, now())),
    'surgeons', coalesce((
      select jsonb_agg(jsonb_build_object('doctor_id', s.doctor_id, 'role', s.role, 'name', coalesce(d.display_name, d.full_name))
                       order by s.role = 'primary' desc, d.full_name)
      from public.admission_surgeons s join public.doctors d on d.id = s.doctor_id where s.admission_id = a.id), '[]'::jsonb),
    'bills', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'bill_type', b.bill_type, 'bill_no', b.bill_no, 'status', b.status,
                                          'total_paise', b.total_paise + b.carried_in_paise, 'bill_at', b.bill_at,
                                          'consolidated_into_id', b.consolidated_into_id)
                       order by coalesce(b.bill_at, b.created_at))
      from public.bills b where b.admission_id = a.id), '[]'::jsonb),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'bill_id', b.id, 'bill_type', b.bill_type, 'bill_no', b.bill_no,
                                          'bill_status', b.status, 'service_date', coalesce(i.service_date, (private.ist(coalesce(b.bill_at, b.created_at)))::date),
                                          'description', i.description, 'qty', i.qty, 'rate_paise', i.rate_paise,
                                          'total_paise', i.total_paise)
                       order by coalesce(i.service_date, (private.ist(coalesce(b.bill_at, b.created_at)))::date), b.created_at, i.line_no)
      from public.bills b join public.bill_items i on i.bill_id = b.id
      where b.admission_id = a.id and b.status <> 'cancelled' and i.kind <> 'carried_in'), '[]'::jsonb),
    'charges_total_paise', (
      select coalesce(sum(i.total_paise), 0)
      from public.bills b join public.bill_items i on i.bill_id = b.id
      where b.admission_id = a.id and b.status <> 'cancelled' and i.kind <> 'carried_in'),
    'summary', (select jsonb_build_object('id', s.id, 'status', s.status, 'version', s.version)
                  from public.discharge_summaries s where s.admission_id = a.id and s.status <> 'cancelled'))
  from public.admissions a
  join public.patients p on p.id = a.patient_id
  left join public.patient_treatments t on t.id = a.treatment_id
  left join public.room_types r on r.id = a.room_type_id
  where a.id = p_id;
$$;

select private.lock_down_public_functions();
