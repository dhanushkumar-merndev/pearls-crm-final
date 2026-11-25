-- Reception manages doctors and services like the admin (owner, 25/11/2026: "same admin feature,
-- only for doctor and service, I need for reception"):
--   * doctors, their weekly hours (doctor_schedules) and leave (doctor_leaves): add / change / remove
--   * services (the bill price list): add / change
--   * the doctor's signature image (prints on discharge summaries): upload
-- Everything else in Admin stays admin-only. Table grants are unchanged (02_rls_matrix): only who
-- passes the row checks changes.

do $$
declare
  t text;
begin
  foreach t in array array['doctors', 'doctor_schedules', 'doctor_leaves', 'services'] loop
    execute format($p$create policy %I on public.%I for insert to authenticated
                      with check ((select private.has_role('receptionist')))$p$, t || '_reception_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
                      using ((select private.has_role('receptionist'))) with check ((select private.has_role('receptionist')))$p$,
                   t || '_reception_update', t);
  end loop;
  foreach t in array array['doctor_schedules', 'doctor_leaves'] loop
    execute format($p$create policy %I on public.%I for delete to authenticated
                      using ((select private.has_role('receptionist')))$p$, t || '_reception_delete', t);
  end loop;
end $$;

-- A doctor's signature must be a doctor-signature upload (never some other file, e.g. a patient's photo).
create function private.doctor_signature_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signature_file_id is not null and new.signature_file_id is distinct from old.signature_file_id
     and not exists (select 1 from public.files f where f.id = new.signature_file_id and f.purpose = 'doctor_signature') then
    perform private.fail('invalid_input', 'signature_file_id');
  end if;
  return new;
end;
$$;
create trigger doctors_signature_guard before update of signature_file_id on public.doctors
  for each row execute function private.doctor_signature_guard();

-- Upload rules per purpose: reception may now upload the doctor's signature too.
create or replace function private.file_rule(p_purpose public.file_purpose)
returns table (roles public.staff_role[], mimes text[], max_bytes bigint)
language sql
immutable
set search_path = ''
as $$
  select r.roles, r.mimes, r.max_bytes
  from (values
    ('prescription'::public.file_purpose, array['receptionist','admin']::public.staff_role[], array['image/webp','image/jpeg','application/pdf'], 3145728::bigint),
    ('document',          array['receptionist','admin']::public.staff_role[], array['image/webp','image/jpeg','image/png','application/pdf'], 3145728),
    ('registration_form', array['receptionist','admin']::public.staff_role[], array['image/webp','image/jpeg','application/pdf'], 3145728),
    ('patient_photo',     array['receptionist','admin']::public.staff_role[], array['image/webp','image/jpeg'], 512000),
    ('call_recording',    array['sales_executive','sales_manager','admin']::public.staff_role[], array['audio/ogg','audio/mp4'], 3145728),
    ('voice_note',        array['sales_executive','sales_manager','bdm','admin']::public.staff_role[], array['audio/ogg','audio/mp4'], 1048576),
    ('visit_recording',   array['bdm','admin']::public.staff_role[], array['audio/ogg','audio/mp4'], 8388608),
    ('punch_photo',       array['bdm','admin']::public.staff_role[], array['image/webp','image/jpeg'], 512000),
    ('selfie',            array['bdm','sales_executive','admin']::public.staff_role[], array['image/webp','image/jpeg'], 512000),
    ('doctor_signature',  array['receptionist','admin']::public.staff_role[], array['image/png','image/webp'], 307200),
    ('pdf',               array['receptionist','admin']::public.staff_role[], array['application/pdf'], 5242880),
    ('thumbnail',         array['receptionist','sales_executive','sales_manager','bdm','admin']::public.staff_role[], array['image/webp','image/jpeg'], 102400)
  ) as r (purpose, roles, mimes, max_bytes)
  where r.purpose = p_purpose;
$$;

select private.lock_down_public_functions();
