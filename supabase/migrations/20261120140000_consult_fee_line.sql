-- Phase 19d (Mary's questions, 16/11/2026): the doctor's consultation fee is used. A new surgery bill
-- for a consultation (a visit or booking that is not a treatment session or an IP stay) starts with a
-- "Consultation – Dr X" line at the doctor's fee (doctors.consultation_fee_paise; no line when it is 0).
-- The line is an ordinary draft line: reception can change the amount or remove it.
-- create_bill is otherwise unchanged from 20261116100000_care_links.sql.

create or replace function public.create_bill(p_type public.bill_type, p_patient_id uuid, p_links jsonb default '{}', p_client_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_id uuid := coalesce(p_client_id, gen_random_uuid());
  v_links jsonb := coalesce(p_links, '{}'::jsonb);
  v_treatment public.patient_treatments;
  v_admission public.admissions;
  v_appt public.appointments;
  v_visit public.visits;
  v_session public.treatment_sessions;
  v_doctor public.doctors;
begin
  if exists (select 1 from public.bills where id = v_id) then
    return private.bill_card(v_id);
  end if;
  if not exists (select 1 from public.patients where id = p_patient_id and merged_into_id is null) then
    perform private.fail('not_found', 'patient');
  end if;
  if v_links ->> 'admission_id' is not null then
    select * into v_admission from public.admissions where id = (v_links ->> 'admission_id')::uuid;
    if not found or v_admission.patient_id <> p_patient_id or v_admission.status = 'cancelled' then
      perform private.fail('invalid_input', 'admission');
    end if;
  end if;
  if v_links ->> 'appointment_id' is not null then
    select * into v_appt from public.appointments where id = (v_links ->> 'appointment_id')::uuid;
    if not found or v_appt.patient_id is distinct from p_patient_id then
      perform private.fail('invalid_input', 'appointment_id');
    end if;
    select * into v_visit from public.visits where appointment_id = v_appt.id;
    select * into v_session from public.treatment_sessions where appointment_id = v_appt.id order by seq limit 1;
  end if;
  if v_links ->> 'visit_id' is not null then
    select * into v_visit from public.visits where id = (v_links ->> 'visit_id')::uuid;
    if not found or v_visit.patient_id <> p_patient_id then
      perform private.fail('invalid_input', 'visit_id');
    end if;
    if v_session.id is null and v_visit.appointment_id is not null then
      select * into v_session from public.treatment_sessions where appointment_id = v_visit.appointment_id order by seq limit 1;
    end if;
  end if;
  if v_links ->> 'session_id' is not null then
    select * into v_session from public.treatment_sessions where id = (v_links ->> 'session_id')::uuid;
    if not found or v_session.patient_id <> p_patient_id then
      perform private.fail('invalid_input', 'session_id');
    end if;
    if v_visit.id is null and v_session.appointment_id is not null then
      select * into v_visit from public.visits where appointment_id = v_session.appointment_id;
    end if;
  end if;
  select * into v_treatment from public.patient_treatments
   where id = coalesce((v_links ->> 'treatment_id')::uuid, v_session.treatment_id, v_admission.treatment_id);
  if (v_links ->> 'treatment_id' is not null and not found) or v_treatment.patient_id <> p_patient_id then
    perform private.fail('invalid_input', 'treatment_id');
  end if;
  insert into public.bills (id, bill_type, patient_id, doctor_id, treatment_id, visit_id, session_id, admission_id,
                            tax_inclusive, agreed_price_paise, referred_by_text)
  values (v_id, p_type, p_patient_id,
          coalesce((v_links ->> 'doctor_id')::uuid,
                   (select doctor_id from public.admission_surgeons where admission_id = v_admission.id
                     order by role = 'primary' desc limit 1),
                   v_visit.doctor_id, v_session.doctor_id, v_treatment.doctor_id),
          v_treatment.id, v_visit.id, v_session.id, v_admission.id,
          coalesce((private.setting(case when p_type = 'pharmacy_invoice' then 'pharmacy' else 'billing' end,
                                    case when p_type = 'pharmacy_invoice' then 'prices_include_gst' else 'tax_inclusive' end,
                                    'true'))::boolean, true),
          case when p_type = 'final_bill' then v_treatment.agreed_price_paise end,
          (select referred_by_text from public.patients where id = p_patient_id));
  -- A consultation's bill (a visit or booking that is not a treatment session or an IP stay) starts
  -- with the doctor's consultation fee (19d, 16/11/2026). Reception can change or remove the line.
  if p_type = 'procedure_receipt' and (v_appt.id is not null or v_visit.id is not null)
     and v_session.id is null and v_admission.id is null and v_treatment.id is null then
    select d.* into v_doctor from public.doctors d join public.bills b on b.doctor_id = d.id where b.id = v_id;
    if v_doctor.id is not null and v_doctor.consultation_fee_paise > 0 then
      insert into public.bill_items (bill_id, line_no, category_id, kind, doctor_id, description, service_date, rate_paise, qty, gst_rate_bp)
      values (v_id, 1,
              (select id from public.lookup_values where kind = 'bill_category' and code = 'consultation' and merged_into_id is null limit 1),
              'doctor_charge', v_doctor.id,
              left('Consultation – ' || coalesce(v_doctor.display_name, v_doctor.full_name), 300),
              coalesce(v_visit.visit_date, v_appt.appt_date), v_doctor.consultation_fee_paise, 1, 0);
      perform private.recompute_bill(v_id);
    end if;
  end if;
  return private.bill_card(v_id);
exception
  when invalid_text_representation then
    perform private.fail('invalid_input', 'link');
end;
$$;

select private.lock_down_public_functions();
