-- "Add charges" on an IP stay takes any date (owner, 02/11/2026: a patient admitted today could only
-- be given today's date; staff need earlier and later days too). Same function as
-- 20261113150000_stay_charges.sql without the "admission day up to today" check. The date only
-- labels the line on the final bill. A date that doesn't exist is now refused as invalid_input
-- (it used to escape as a raw 22008 because it was read in DECLARE, outside the handler).

create or replace function public.add_stay_charge(p_admission_id uuid, p_line jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_a public.admissions;
  v_bill public.bills;
  v_date date;
  v_rate bigint := (p_line ->> 'rate_paise')::bigint;
  v_qty numeric := coalesce((p_line ->> 'qty')::numeric, 1);
  v_service public.services;
begin
  -- Read inside the block so a date that doesn't exist (30 Feb) maps to invalid_input below.
  v_date := coalesce(nullif(p_line ->> 'service_date', '')::date, (private.ist(now()))::date);
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
