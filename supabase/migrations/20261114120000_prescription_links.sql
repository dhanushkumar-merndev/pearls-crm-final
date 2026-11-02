-- Prescriptions on the visit / treatment session (owner, 02/11/2026: "upload the doctor's prescription
-- on that session, saved to that visit or session automatically").
-- create_document takes appointment_id / session_id / admission_id (each must be this patient's) and fills
-- the visit, session, doctor and date from them; the Documents list says what each document is for;
-- each treatment session lists its documents.

create index if not exists documents_session on public.documents (session_id) where session_id is not null;
create index if not exists documents_visit on public.documents (visit_id) where visit_id is not null;
create index if not exists documents_admission on public.documents (admission_id) where admission_id is not null;

create or replace function public.create_document(p_doc jsonb, p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_file public.files;
  v_thumb public.files;
  v_patient uuid := (p_doc ->> 'patient_id')::uuid;
  v_sources text[];
  v_appt public.appointments;
  v_session public.treatment_sessions;
  v_visit uuid;
  v_admission uuid;
  v_doctor uuid := (p_doc ->> 'doctor_id')::uuid;
  v_date date := (p_doc ->> 'doc_date')::date;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  if exists (select 1 from public.documents where id = p_client_id) then
    return p_client_id;
  end if;
  if jsonb_typeof(coalesce(p_doc -> 'source_sha256', '[]'::jsonb)) <> 'array' then
    perform private.fail('invalid_input', 'source_sha256');
  end if;
  select coalesce(array_agg(distinct lower(h)), '{}') into v_sources
    from jsonb_array_elements_text(coalesce(p_doc -> 'source_sha256', '[]'::jsonb)) h;
  if not private.all_sha256(v_sources) then
    perform private.fail('invalid_input', 'source_sha256');
  end if;
  select * into v_file from public.files where id = (p_doc ->> 'file_id')::uuid;
  if not found or v_file.status <> 'uploaded' then
    perform private.fail('upload_incomplete');
  end if;
  if v_file.owner_staff_id <> v_staff and not private.has_role('admin') then
    perform private.fail('not_allowed');
  end if;
  if p_doc ->> 'thumbnail_file_id' is not null then
    select * into v_thumb from public.files where id = (p_doc ->> 'thumbnail_file_id')::uuid;
    if not found or v_thumb.status <> 'uploaded' or v_thumb.purpose <> 'thumbnail' then
      perform private.fail('upload_incomplete', 'thumbnail');
    end if;
    if v_thumb.owner_staff_id <> v_staff and not private.has_role('admin') then
      perform private.fail('not_allowed');
    end if;
  end if;
  if not exists (select 1 from public.patients where id = v_patient and merged_into_id is null) then
    perform private.fail('not_found');
  end if;
  -- What the document belongs to (a prescription from a visit, a treatment session or an IP stay).
  -- Each link must be this patient's; the visit, session, doctor and date follow from it when not given.
  if p_doc ->> 'appointment_id' is not null then
    select * into v_appt from public.appointments where id = (p_doc ->> 'appointment_id')::uuid;
    if not found or v_appt.patient_id is distinct from v_patient then
      perform private.fail('invalid_input', 'appointment_id');
    end if;
    select v.id into v_visit from public.visits v where v.appointment_id = v_appt.id;
    select * into v_session from public.treatment_sessions s where s.appointment_id = v_appt.id limit 1;
    v_doctor := coalesce(v_doctor, v_appt.doctor_id);
    v_date := coalesce(v_date, (private.ist(v_appt.slot_start))::date);
  end if;
  if p_doc ->> 'session_id' is not null then
    select * into v_session from public.treatment_sessions where id = (p_doc ->> 'session_id')::uuid;
    if not found or v_session.patient_id <> v_patient then
      perform private.fail('invalid_input', 'session_id');
    end if;
    if v_visit is null and v_session.appointment_id is not null then
      select v.id into v_visit from public.visits v where v.appointment_id = v_session.appointment_id;
    end if;
  end if;
  if v_session.id is not null then
    v_doctor := coalesce(v_doctor, v_session.doctor_id,
                         (select t.doctor_id from public.patient_treatments t where t.id = v_session.treatment_id));
    v_date := coalesce(v_date, v_session.actual_date);
  end if;
  if p_doc ->> 'admission_id' is not null then
    select a.id into v_admission from public.admissions a
     where a.id = (p_doc ->> 'admission_id')::uuid and a.patient_id = v_patient;
    if v_admission is null then
      perform private.fail('invalid_input', 'admission_id');
    end if;
  end if;

  update public.files set patient_id = v_patient, linked_table = 'documents', linked_id = p_client_id
   where id in (v_file.id, v_thumb.id);
  insert into public.documents (id, patient_id, kind_id, title, doc_date, doctor_id, file_id, thumbnail_file_id,
                                page_count, source_sha256, visit_id, session_id, admission_id)
  values (p_client_id, v_patient, (p_doc ->> 'kind_id')::uuid,
          coalesce(nullif(btrim(p_doc ->> 'title'), ''), 'Document'),
          coalesce(v_date, (private.ist(now()))::date),
          v_doctor, v_file.id, v_thumb.id,
          (p_doc ->> 'page_count')::int, v_sources, v_visit, v_session.id, v_admission);
  perform private.library_used('lookup_values', (p_doc ->> 'kind_id')::uuid);
  return p_client_id;
end;
$$;

create or replace function public.patient_documents(p_patient_id uuid, p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_date date;
  v_id uuid;
  v_items jsonb;
  v_count integer;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if p_cursor is not null then
    begin
      v_date := split_part(p_cursor, '|', 1)::date;
      v_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      perform private.fail('invalid_input', 'cursor');
    end;
  end if;
  with page as (
    select d.id, d.title, d.doc_date, d.file_id, d.thumbnail_file_id, d.page_count, d.created_at,
           l.label as kind, f.mime, f.size_bytes,
           coalesce(doc.display_name, doc.full_name) as doctor,
           s.seq as session_seq, t.name as treatment, v.visit_date, ad.ip_number
    from public.documents d
    join public.files f on f.id = d.file_id
    left join public.lookup_values l on l.id = d.kind_id
    left join public.doctors doc on doc.id = d.doctor_id
    left join public.treatment_sessions s on s.id = d.session_id
    left join public.patient_treatments t on t.id = s.treatment_id
    left join public.visits v on v.id = d.visit_id
    left join public.admissions ad on ad.id = d.admission_id
    where d.patient_id = p_patient_id and not d.archived
      and (v_date is null or (d.doc_date, d.id) < (v_date, v_id))
    order by d.doc_date desc, d.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by page.doc_date desc, page.id desc), '[]'::jsonb), count(*)
    into v_items, v_count
  from page;
  if v_count > v_limit then
    v_items := v_items - v_limit;
    return jsonb_build_object('items', v_items,
      'next_cursor', format('%s|%s', v_items -> (v_limit - 1) ->> 'doc_date', v_items -> (v_limit - 1) ->> 'id'));
  end if;
  return jsonb_build_object('items', v_items, 'next_cursor', null);
end;
$$;

create or replace function private.treatment_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(t) || jsonb_build_object(
    'doctor', coalesce(d.display_name, d.full_name),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'seq', s.seq, 'planned_date', s.planned_date, 'actual_date', s.actual_date,
               'status', s.status, 'appointment_id', s.appointment_id, 'slot_start', a.slot_start, 'notes', s.notes,
               'documents', coalesce((
                 select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'file_id', d.file_id) order by d.created_at)
                 from public.documents d where d.session_id = s.id and not d.archived), '[]'::jsonb))
             order by s.seq)
      from public.treatment_sessions s left join public.appointments a on a.id = s.appointment_id
      where s.treatment_id = t.id), '[]'::jsonb),
    'done_count', (select count(*) from public.treatment_sessions s where s.treatment_id = t.id and s.status = 'done'))
  from public.patient_treatments t left join public.doctors d on d.id = t.doctor_id
  where t.id = p_id;
$$;

select private.lock_down_public_functions();
