-- Phase 19d: the doctor's signature image prints on discharge summaries. The admin uploads it on the
-- doctor's page (purpose 'doctor_signature', admin only, PNG/WebP ≤ 300 KB, doctors.signature_file_id).
--   * files_select: reception may also view doctor signatures (they print the summaries). Nothing else changes.
--   * discharge_signature_file(summary): the signing doctor's signature file, or null. Same doctor as
--     the summary's signature block: the chosen "Signed by" doctor, else the stay's primary surgeon
--     (IP) or the visit's doctor (OP).

drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    (select private.has_role('admin'))
    or owner_staff_id = (select private.my_staff_id())
    or (patient_id is not null and (select private.has_role('receptionist'))
        and purpose in ('prescription', 'document', 'registration_form', 'patient_photo', 'pdf', 'thumbnail'))
    or (purpose in ('call_recording', 'voice_note') and (select private.has_role('sales_manager')))
    or (purpose = 'call_recording' and patient_id is not null and (select private.has_role('receptionist'))
        and (select private.reception_plays_recordings()))
    or (purpose = 'doctor_signature' and (select private.has_role('receptionist')))
  );

create function public.discharge_signature_file(p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.discharge_summaries;
  v_doctor uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_s from public.discharge_summaries where id = p_id;
  if not found then
    perform private.fail('not_found');
  end if;
  v_doctor := nullif(v_s.content ->> 'doctor_id', '')::uuid;
  if v_doctor is null and v_s.admission_id is not null then
    select s.doctor_id into v_doctor from public.admission_surgeons s
     where s.admission_id = v_s.admission_id order by s.role = 'primary' desc limit 1;
  end if;
  if v_doctor is null and v_s.admission_id is null then
    v_doctor := nullif(private.op_card(v_s.visit_id, v_s.session_id) ->> 'doctor_id', '')::uuid;
  end if;
  return (select f.id from public.doctors d join public.files f on f.id = d.signature_file_id and f.status = 'uploaded'
           where d.id = v_doctor);
exception
  when invalid_text_representation then
    return null;
end;
$$;

select private.lock_down_public_functions();
