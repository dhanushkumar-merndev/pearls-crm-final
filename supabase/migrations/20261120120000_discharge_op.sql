-- Phase 19b: discharge summary for OP visits too (owner, 17/11/2026: "discharge summary is not only
-- for IP, OP also"). A summary belongs to an IP stay (as before) OR to an OP visit / treatment session.
--   * discharge_summaries: admission_id nullable; + visit_id, session_id; exactly one kind; one per
--     visit (or per session done without a visit) while not cancelled.
--   * private.op_vars: the OP placeholder values (patient, visit_on, procedure_on, procedure, doctor,
--     and admitted_on / discharged_on / surgery_on / surgeon so most IP templates still fill).
--     IP summaries also get doctor / visit_on / procedure_on.
--   * summary_card, freeze_summary, finalize (follow-up from the visit date), discharge_print_data,
--     pharmacy_bill_from_meds, save_discharge_template work for both kinds. OP finalize needs a
--     doctor (new error doctor_required); the IP checks (discharged, surgeon) stay IP only.
--   * discharge_autofill_op(visit, session, template), discharge_op_targets(patient) for the picker.
--   * save_discharge_summary gains p_visit_id / p_session_id (dropped and recreated).
--   * discharge_summaries_table and bill_paperwork list / offer OP summaries.

------------------------------------------------------------------------------
-- Table
------------------------------------------------------------------------------
alter table public.discharge_summaries alter column admission_id drop not null;
alter table public.discharge_summaries add column visit_id uuid references public.visits (id);
alter table public.discharge_summaries add column session_id uuid references public.treatment_sessions (id);
alter table public.discharge_summaries add constraint discharge_summaries_kind check (
  (admission_id is not null and visit_id is null and session_id is null)
  or (admission_id is null and (visit_id is not null or session_id is not null)));
create unique index discharge_summaries_one_visit on public.discharge_summaries (visit_id)
  where visit_id is not null and status <> 'cancelled';
create unique index discharge_summaries_one_session on public.discharge_summaries (session_id)
  where visit_id is null and session_id is not null and status <> 'cancelled';
create index discharge_summaries_session_fk on public.discharge_summaries (session_id) where session_id is not null;

------------------------------------------------------------------------------
-- OP: what a visit / session is (date, treatment, doctor) and its placeholder values.
------------------------------------------------------------------------------
create function private.op_card(p_visit_id uuid, p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'visit_id', v.id, 'session_id', s.id, 'appointment_id', coalesce(v.appointment_id, s.appointment_id),
    'patient_id', coalesce(v.patient_id, s.patient_id),
    'date', coalesce(v.visit_date, s.actual_date, s.planned_date),
    'treatment_id', t.id, 'treatment', t.name, 'session_seq', s.seq,
    'doctor_id', d.id, 'doctor', coalesce(d.display_name, d.full_name))
  from (select 1) one
  left join public.visits v on v.id = p_visit_id
  left join public.treatment_sessions s on s.id = p_session_id
  left join public.patient_treatments t on t.id = s.treatment_id
  left join public.doctors d on d.id = coalesce(v.doctor_id, s.doctor_id, t.doctor_id)
  where v.id is not null or s.id is not null;
$$;

create function private.op_vars(p_visit_id uuid, p_session_id uuid, p_content jsonb default '{}')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with op as (select private.op_card(p_visit_id, p_session_id) as c),
  x as (
    select op.c, p.*, (op.c ->> 'date')::date as on_date,
           (select concat_ws(' ', coalesce(d.display_name, d.full_name), nullif(d.qualification, ''))
              from public.doctors d
             where d.id = coalesce((p_content ->> 'doctor_id')::uuid, (op.c ->> 'doctor_id')::uuid)) as doctor
    from op join public.patients p on p.id = (op.c ->> 'patient_id')::uuid
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'patient_name', concat_ws(' ', x.title, x.full_name),
    'first_name', split_part(btrim(x.full_name), ' ', 1),
    'age', (private.age_years(x.dob))::text,
    'gender', case x.gender when 'female' then 'female' when 'male' then 'male' end,
    'he_she', case x.gender when 'female' then 'she' when 'male' then 'he' else 'they' end,
    'He_She', case x.gender when 'female' then 'She' when 'male' then 'He' else 'They' end,
    'him_her', case x.gender when 'female' then 'her' when 'male' then 'him' else 'them' end,
    'Him_Her', case x.gender when 'female' then 'Her' when 'male' then 'Him' else 'Them' end,
    'his_her', case x.gender when 'female' then 'her' when 'male' then 'his' else 'their' end,
    'His_Her', case x.gender when 'female' then 'Her' when 'male' then 'His' else 'Their' end,
    'uhid', x.uhid,
    'visit_on', to_char(x.on_date, 'DD/MM/YYYY'),
    'procedure_on', to_char(x.on_date, 'DD/MM/YYYY'),
    'procedure', x.c ->> 'treatment',
    'doctor', x.doctor,
    -- So most IP templates still fill for a day procedure: in and out the same day.
    'admitted_on', to_char(x.on_date, 'DD/MM/YYYY'),
    'discharged_on', to_char(x.on_date, 'DD/MM/YYYY'),
    'surgery_on', to_char(x.on_date, 'DD/MM/YYYY'),
    'surgeon', x.doctor,
    'surgeons', x.doctor,
    'clinic_name', (select name from public.clinic_settings order by branch_code = 'main' desc limit 1),
    'follow_up_days', nullif(p_content ->> 'follow_up_days', ''),
    'follow_up_date', case when (p_content ->> 'follow_up_days') ~ '^[0-9]+$'
                           then to_char(x.on_date + (p_content ->> 'follow_up_days')::int, 'DD/MM/YYYY') end))
  from x;
$$;

-- The values for any summary: an IP stay's (plus doctor / visit_on / procedure_on), or an OP visit's.
create function private.summary_vars(p_admission_id uuid, p_visit_id uuid, p_session_id uuid, p_content jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_admission_id is not null then (
      select v || jsonb_strip_nulls(jsonb_build_object('doctor', v ->> 'surgeon', 'visit_on', v ->> 'admitted_on',
                                                       'procedure_on', v ->> 'surgery_on'))
      from (select private.discharge_vars(p_admission_id, p_content) as v) d)
    else private.op_vars(p_visit_id, p_session_id, p_content)
  end;
$$;

-- Every section, medicine and the follow-up note filled with the given values.
create function private.render_with(p_vars jsonb, p_content jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('key', s ->> 'key',
                                          'title', private.render_placeholders(s ->> 'title', p_vars),
                                          'body', private.render_placeholders(s ->> 'body', p_vars)) order by o)
      from jsonb_array_elements(coalesce(p_content -> 'sections', '[]')) with ordinality x (s, o)), '[]'::jsonb),
    'medications', coalesce((
      select jsonb_agg((
        select jsonb_object_agg(f.key, case when jsonb_typeof(f.value) = 'string'
                                            then to_jsonb(private.render_placeholders(f.value #>> '{}', p_vars)) else f.value end)
        from jsonb_each(m) f) order by o)
      from jsonb_array_elements(coalesce(p_content -> 'medications', '[]')) with ordinality x (m, o)), '[]'::jsonb),
    'follow_up_note', private.render_placeholders(p_content ->> 'follow_up_note', p_vars),
    'follow_up_days', p_content -> 'follow_up_days',
    'vars', p_vars);
$$;

-- A summary row filled in (IP or OP).
create function private.summary_render(s public.discharge_summaries)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.render_with(private.summary_vars(s.admission_id, s.visit_id, s.session_id, s.content), s.content);
$$;

create or replace function private.summary_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(s) || jsonb_build_object(
    'kind', case when s.admission_id is not null then 'ip' else 'op' end,
    'admission', case when s.admission_id is not null then private.admission_card(s.admission_id) end,
    'op', case when s.admission_id is null then private.op_card(s.visit_id, s.session_id) end,
    'patient', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'uhid', p.uhid) from public.patients p where p.id = s.patient_id),
    'preview', case when s.status = 'draft' then private.summary_render(s) else s.rendered end,
    'template', (select name from public.discharge_templates where id = s.template_id))
  from public.discharge_summaries s where s.id = p_id;
$$;

------------------------------------------------------------------------------
-- Picker and autofill for OP
------------------------------------------------------------------------------
-- The patient's OP visits and treatment sessions done (newest first, at most 60), each with the
-- summary it already has. A session booked through an appointment shows once, with its visit.
create function public.discharge_op_targets(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.date desc, r.session_seq nulls last)
    from (
      select x.visit_id, x.session_id, x.date, x.treatment, x.session_seq, x.doctor,
             (select ds.id from public.discharge_summaries ds
               where ds.status <> 'cancelled' and ds.admission_id is null
                 and (ds.visit_id = x.visit_id or x.visit_id is null and ds.visit_id is null and ds.session_id = x.session_id)
               limit 1) as summary_id
      from (
        select v.id as visit_id, s.id as session_id, v.visit_date as date, t.name as treatment, s.seq as session_seq,
               coalesce(d.display_name, d.full_name) as doctor
        from public.visits v
        left join lateral (select * from public.treatment_sessions ts
                            where v.appointment_id is not null and ts.appointment_id = v.appointment_id
                            order by ts.seq limit 1) s on true
        left join public.patient_treatments t on t.id = s.treatment_id
        left join public.doctors d on d.id = coalesce(v.doctor_id, s.doctor_id, t.doctor_id)
        where v.patient_id = p_patient_id
        union all
        select null, s.id, coalesce(s.actual_date, s.planned_date), t.name, s.seq, coalesce(d.display_name, d.full_name)
        from public.treatment_sessions s
        join public.patient_treatments t on t.id = s.treatment_id
        left join public.doctors d on d.id = coalesce(s.doctor_id, t.doctor_id)
        where s.patient_id = p_patient_id and s.status = 'done'
          and not exists (select 1 from public.visits v where s.appointment_id is not null and v.appointment_id = s.appointment_id)
      ) x
      order by x.date desc
      limit 60
    ) r), '[]'::jsonb);
end;
$$;

-- Resolve an OP link the way create_bill does: a session's booking gives its visit, a visit's booking
-- gives its session. Both must be this patient's (when given).
create function private.op_resolve(p_visit_id uuid, p_session_id uuid)
returns table (visit_id uuid, session_id uuid, patient_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_session public.treatment_sessions;
begin
  if p_visit_id is not null then
    select * into v_visit from public.visits where id = p_visit_id;
    if not found then
      perform private.fail('not_found', 'visit');
    end if;
  end if;
  if p_session_id is not null then
    select * into v_session from public.treatment_sessions where id = p_session_id;
    if not found then
      perform private.fail('not_found', 'session');
    end if;
  end if;
  if v_visit.id is null and v_session.id is null then
    perform private.fail('invalid_input', 'visit or session');
  end if;
  if v_visit.id is not null and v_session.id is null and v_visit.appointment_id is not null then
    select * into v_session from public.treatment_sessions where appointment_id = v_visit.appointment_id order by seq limit 1;
  end if;
  if v_session.id is not null and v_visit.id is null and v_session.appointment_id is not null then
    select * into v_visit from public.visits where appointment_id = v_session.appointment_id;
  end if;
  if v_visit.id is not null and v_session.id is not null and v_visit.patient_id <> v_session.patient_id then
    perform private.fail('invalid_input', 'visit and session are for different patients');
  end if;
  return query select v_visit.id, v_session.id, coalesce(v_visit.patient_id, v_session.patient_id);
end;
$$;

-- What a new OP summary starts from: the visit/session, the treatment's template (or a given one),
-- medicines from its pharmacy bills, and the placeholder values.
create function public.discharge_autofill_op(p_visit_id uuid, p_session_id uuid, p_template_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visit uuid;
  v_session uuid;
  v_patient uuid;
  v_treatment uuid;
  v_template public.discharge_templates;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select r.visit_id, r.session_id, r.patient_id into v_visit, v_session, v_patient from private.op_resolve(p_visit_id, p_session_id) r;
  v_treatment := (select treatment_id from public.treatment_sessions where id = v_session);
  select * into v_template from public.discharge_templates
   where id = coalesce(p_template_id,
                       (select discharge_template_id from public.patient_treatments where id = v_treatment),
                       (select t.discharge_template_id from public.patient_treatments pt
                          join public.treatment_templates t on t.id = pt.template_id where pt.id = v_treatment))
     and active;
  return jsonb_build_object(
    'op', private.op_card(v_visit, v_session),
    'vars', private.op_vars(v_visit, v_session, jsonb_build_object('follow_up_days', v_template.follow_up_days)),
    'template', case when v_template.id is not null then jsonb_build_object(
      'id', v_template.id, 'name', v_template.name, 'sections', v_template.sections, 'medications', v_template.medications,
      'follow_up_days', v_template.follow_up_days) end,
    'pharmacy_medicines', coalesce((
      select jsonb_agg(jsonb_build_object('pharmacy_item_id', x.pharmacy_item_id, 'name', x.name, 'dose', '', 'frequency', '',
                                          'duration', '', 'instructions', '') order by x.name)
      from (select distinct i.pharmacy_item_id, concat_ws(' ', pi.name, pi.strength) as name
              from public.bills b join public.bill_items i on i.bill_id = b.id and i.kind = 'pharmacy'
              join public.pharmacy_items pi on pi.id = i.pharmacy_item_id
             where b.status = 'finalized' and b.patient_id = v_patient
               and (b.visit_id = v_visit or b.session_id = v_session)) x), '[]'::jsonb));
end;
$$;

------------------------------------------------------------------------------
-- Save (create or autosave): IP with p_admission_id as before; OP with p_visit_id and/or p_session_id.
------------------------------------------------------------------------------
drop function public.save_discharge_summary(uuid, uuid, jsonb, integer, uuid);
create function public.save_discharge_summary(p_id uuid, p_admission_id uuid, p_content jsonb, p_version integer default null,
                                              p_template_id uuid default null, p_visit_id uuid default null,
                                              p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.discharge_summaries;
  v_a public.admissions;
  v_visit uuid;
  v_session uuid;
  v_patient uuid;
begin
  if p_id is null or jsonb_typeof(p_content) <> 'object' then
    perform private.fail('invalid_input');
  end if;
  if jsonb_array_length(coalesce(p_content -> 'sections', '[]')) > 40 or jsonb_array_length(coalesce(p_content -> 'medications', '[]')) > 60
     or length(p_content::text) > 100000 then
    perform private.fail('invalid_input', 'the summary is too long');
  end if;
  select * into v_s from public.discharge_summaries where id = p_id for update;
  if not found then
    if p_version is not null then
      perform private.fail('not_found');
    end if;
    if p_admission_id is not null then
      select * into v_a from public.admissions where id = p_admission_id and status <> 'cancelled';
      if not found then
        perform private.fail('not_found', 'admission');
      end if;
      if exists (select 1 from public.discharge_summaries where admission_id = p_admission_id and status <> 'cancelled') then
        perform private.fail('duplicate', 'this stay already has a discharge summary');
      end if;
      insert into public.discharge_summaries (id, admission_id, patient_id, content, template_id)
      values (p_id, p_admission_id, v_a.patient_id, p_content, p_template_id);
    else
      select r.visit_id, r.session_id, r.patient_id into v_visit, v_session, v_patient from private.op_resolve(p_visit_id, p_session_id) r;
      if exists (select 1 from public.discharge_summaries
                  where status <> 'cancelled' and admission_id is null
                    and (visit_id = v_visit or v_visit is null and visit_id is null and session_id = v_session)) then
        perform private.fail('duplicate', 'this visit already has a discharge summary');
      end if;
      begin
        insert into public.discharge_summaries (id, visit_id, session_id, patient_id, content, template_id)
        values (p_id, v_visit, v_session, v_patient, p_content, p_template_id);
      exception when unique_violation then
        perform private.fail('duplicate', 'this visit already has a discharge summary');
      end;
    end if;
    if p_template_id is not null then
      update public.discharge_templates set usage_count = usage_count + 1 where id = p_template_id;
    end if;
    return private.summary_card(p_id);
  end if;
  if p_version is null then
    return private.summary_card(p_id); -- a retried create
  end if;
  if v_s.status <> 'draft' then
    perform private.fail('bill_locked', 'finalized summaries are amended by an admin');
  end if;
  if v_s.version <> p_version then
    perform private.fail('stale_version');
  end if;
  update public.discharge_summaries set content = p_content, version = version + 1,
         template_id = coalesce(p_template_id, template_id)
   where id = p_id;
  return private.summary_card(p_id);
end;
$$;

------------------------------------------------------------------------------
-- Freeze (finalize / amend): IP checks as before; OP needs a doctor.
------------------------------------------------------------------------------
create or replace function private.freeze_summary(p_id uuid, p_staff uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.discharge_summaries;
  v_a public.admissions;
  v_op jsonb;
  v_rendered jsonb;
  v_left text[];
  v_doctor public.doctors;
begin
  select * into v_s from public.discharge_summaries where id = p_id;
  if v_s.admission_id is null then
    v_op := private.op_card(v_s.visit_id, v_s.session_id);
    select * into v_doctor from public.doctors
     where id = coalesce((v_s.content ->> 'doctor_id')::uuid, (v_op ->> 'doctor_id')::uuid);
    if not found then
      perform private.fail('doctor_required');
    end if;
    v_rendered := private.summary_render(v_s);
    v_left := private.leftover_placeholders(v_rendered);
    if cardinality(v_left) > 0 then
      perform private.fail('placeholders_left', array_to_string(v_left, ', '));
    end if;
    update public.discharge_summaries set
      status = 'finalized', rendered = v_rendered, finalized_at = now(), finalized_by = p_staff,
      header_snapshot = private.clinic_snapshot('final_bill') - 'terms',
      patient_snapshot = private.patient_snapshot(v_s.patient_id, v_doctor.id) || jsonb_build_object(
        'kind', 'op', 'visit_date', v_op ->> 'date', 'treatment', v_op ->> 'treatment',
        'session_seq', v_op -> 'session_seq', 'procedures', case when v_op ->> 'treatment' is not null then jsonb_build_array(v_op ->> 'treatment') else '[]'::jsonb end,
        'signature', jsonb_build_object('name', coalesce(v_doctor.display_name, v_doctor.full_name), 'qualification', v_doctor.qualification,
                                        'designation', v_doctor.designation, 'reg_council', v_doctor.reg_council,
                                        'reg_number', v_doctor.reg_number)),
      version = version + 1
    where id = p_id;
    return;
  end if;

  select * into v_a from public.admissions where id = v_s.admission_id for update;
  if v_a.status <> 'discharged' or v_a.discharged_at is null then
    perform private.fail('not_discharged');
  end if;
  if v_a.surgery_at is not null and (v_a.surgery_at < v_a.admitted_at or v_a.surgery_at > v_a.discharged_at) then
    perform private.fail('dates_invalid', 'surgery must be inside the stay');
  end if;
  if not exists (select 1 from public.admission_surgeons where admission_id = v_a.id) then
    perform private.fail('surgeon_required');
  end if;
  select * into v_doctor from public.doctors where id = (v_s.content ->> 'doctor_id')::uuid;
  if not found then
    v_doctor := null;
    select d.* into v_doctor from public.admission_surgeons s join public.doctors d on d.id = s.doctor_id
     where s.admission_id = v_a.id order by s.role = 'primary' desc limit 1;
  end if;
  v_rendered := private.summary_render(v_s);
  v_left := private.leftover_placeholders(v_rendered);
  if cardinality(v_left) > 0 then
    perform private.fail('placeholders_left', array_to_string(v_left, ', '));
  end if;
  update public.discharge_summaries set
    status = 'finalized', rendered = v_rendered, finalized_at = now(), finalized_by = p_staff,
    header_snapshot = private.clinic_snapshot('final_bill') - 'terms',
    patient_snapshot = private.patient_snapshot(v_a.patient_id, v_doctor.id) || jsonb_build_object(
      'kind', 'ip',
      'ip_number', v_a.ip_number, 'admitted_at', v_a.admitted_at, 'discharged_at', v_a.discharged_at,
      'surgery_at', v_a.surgery_at, 'procedures', to_jsonb(v_a.procedures), 'anaesthesia', v_a.anaesthesia,
      'diagnosis', v_a.diagnosis, 'room', (select name from public.room_types where id = v_a.room_type_id),
      'room_label', v_a.room_label, 'surgeons', (v_rendered -> 'vars') ->> 'surgeons',
      'signature', jsonb_build_object('name', coalesce(v_doctor.display_name, v_doctor.full_name), 'qualification', v_doctor.qualification,
                                      'designation', v_doctor.designation, 'reg_council', v_doctor.reg_council,
                                      'reg_number', v_doctor.reg_number)),
    version = version + 1
  where id = p_id;
end;
$$;

-- Finalize: as before; the follow-up is dated from discharge (IP) or from the visit (OP).
create or replace function public.finalize_discharge_summary(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.discharge_summaries;
  v_days integer;
  v_fu uuid;
  v_op jsonb;
begin
  select * into v_s from public.discharge_summaries where id = p_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_s.status <> 'draft' then
    perform private.fail('bill_locked');
  end if;
  if v_s.version <> p_version then
    perform private.fail('stale_version');
  end if;
  perform private.freeze_summary(p_id, v_staff);
  v_days := case when (v_s.content ->> 'follow_up_days') ~ '^[0-9]+$' then (v_s.content ->> 'follow_up_days')::int end;
  if v_days is not null and v_days > 0 then
    if v_s.admission_id is not null then
      insert into public.followups (kind, patient_id, due_date, reason, source, ref_table, ref_id)
      select 'followup', a.patient_id, (private.ist(a.discharged_at))::date + v_days,
             left('Follow-up after discharge' || coalesce(': ' || nullif(array_to_string(a.procedures, ', '), ''), ''), 500),
             'discharge', 'discharge_summaries', p_id
      from public.admissions a where a.id = v_s.admission_id
      on conflict (kind, ref_table, ref_id) where ref_id is not null and status = 'open' do nothing
      returning id into v_fu;
    else
      v_op := private.op_card(v_s.visit_id, v_s.session_id);
      insert into public.followups (kind, patient_id, due_date, reason, source, ref_table, ref_id)
      values ('followup', v_s.patient_id, (v_op ->> 'date')::date + v_days,
              left('Follow-up after procedure' || coalesce(': ' || nullif(v_op ->> 'treatment', ''), ''), 500),
              'discharge', 'discharge_summaries', p_id)
      on conflict (kind, ref_table, ref_id) where ref_id is not null and status = 'open' do nothing
      returning id into v_fu;
    end if;
    update public.discharge_summaries set followup_id = coalesce(v_fu, followup_id) where id = p_id;
  end if;
  return private.summary_card(p_id);
end;
$$;

-- Print: the frozen text, or a live preview for a draft (IP or OP).
create or replace function public.discharge_print_data(p_id uuid, p_count boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.discharge_summaries;
  v_a public.admissions;
  v_op jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_s from public.discharge_summaries where id = p_id;
  if not found then
    perform private.fail('not_found');
  end if;
  if p_count and v_s.status = 'finalized' then
    update public.discharge_summaries set print_count = print_count + 1 where id = p_id returning * into v_s;
  end if;
  if v_s.admission_id is not null then
    select * into v_a from public.admissions where id = v_s.admission_id;
  else
    v_op := private.op_card(v_s.visit_id, v_s.session_id);
  end if;
  return jsonb_build_object(
    'id', v_s.id, 'status', v_s.status, 'print_count', v_s.print_count,
    'kind', case when v_s.admission_id is not null then 'ip' else 'op' end,
    'copy', case when v_s.status = 'draft' then 'draft' when v_s.print_count <= 1 then 'original' else 'duplicate' end,
    'header', coalesce(v_s.header_snapshot, private.clinic_snapshot('final_bill') - 'terms'),
    'patient_strip', coalesce(v_s.patient_snapshot,
      case when v_s.admission_id is not null then
        private.patient_snapshot(v_a.patient_id, null) || jsonb_build_object(
          'kind', 'ip', 'ip_number', v_a.ip_number, 'admitted_at', v_a.admitted_at, 'discharged_at', v_a.discharged_at,
          'surgery_at', v_a.surgery_at, 'procedures', to_jsonb(v_a.procedures), 'anaesthesia', v_a.anaesthesia, 'diagnosis', v_a.diagnosis)
      else
        private.patient_snapshot(v_s.patient_id, coalesce((v_s.content ->> 'doctor_id')::uuid, (v_op ->> 'doctor_id')::uuid))
        || jsonb_build_object('kind', 'op', 'visit_date', v_op ->> 'date', 'treatment', v_op ->> 'treatment',
                              'session_seq', v_op -> 'session_seq',
                              'procedures', case when v_op ->> 'treatment' is not null then jsonb_build_array(v_op ->> 'treatment') else '[]'::jsonb end)
      end),
    'body', coalesce(v_s.rendered, private.summary_render(v_s)),
    'finalized_at', v_s.finalized_at);
end;
$$;

-- Pharmacy bill from the summary's medicines: linked to the stay (IP) or the visit / session (OP).
create or replace function public.pharmacy_bill_from_meds(p_summary_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.discharge_summaries;
  v_bill jsonb;
  v_items jsonb;
begin
  select * into v_s from public.discharge_summaries where id = p_summary_id;
  if not found then
    perform private.fail('not_found');
  end if;
  v_bill := public.create_bill('pharmacy_invoice', v_s.patient_id,
                               case when v_s.admission_id is not null then jsonb_build_object('admission_id', v_s.admission_id)
                                    else jsonb_strip_nulls(jsonb_build_object('visit_id', v_s.visit_id, 'session_id', v_s.session_id)) end,
                               p_client_id);
  if (v_bill ->> 'version')::int > 1 or jsonb_array_length(v_bill -> 'items') > 0 then
    return v_bill; -- a retry
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'pharmacy', 'batch_id', b.id,
                    'description', concat_ws(' ', pi.name, pi.strength), 'rate_paise',
                    coalesce(nullif(b.selling_price_paise, 0), nullif(b.mrp_paise, 0), pi.selling_price_paise),
                    'qty', 1, 'gst_rate_bp', pi.gst_rate_bp) order by m.o), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(coalesce(v_s.content -> 'medications', '[]')) with ordinality m (med, o)
  join public.pharmacy_items pi on pi.id = (m.med ->> 'pharmacy_item_id')::uuid
  join lateral (select * from public.item_batches bb
                 where bb.item_id = pi.id and bb.qty_on_hand > 0 and bb.expiry_date >= (private.ist(now()))::date
                 order by bb.expiry_date, bb.created_at limit 1) b on true;
  return public.save_bill((v_bill ->> 'id')::uuid, '{}', v_items, (v_bill ->> 'version')::int);
end;
$$;

-- Save as template: the treatment template comes from the stay's or the session's treatment.
create or replace function public.save_discharge_template(p_summary_id uuid, p_name text, p_template_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_s public.discharge_summaries;
  v_id uuid;
begin
  select * into v_s from public.discharge_summaries where id = p_summary_id;
  if not found then
    perform private.fail('not_found');
  end if;
  if p_template_id is null then
    if length(btrim(coalesce(p_name, ''))) = 0 then
      perform private.fail('invalid_input', 'name');
    end if;
    insert into public.discharge_templates (name, treatment_template_id, sections, medications, follow_up_days)
    values (btrim(p_name),
            (select pt.template_id from public.patient_treatments pt
              where pt.id = coalesce((select treatment_id from public.admissions where id = v_s.admission_id),
                                     (select treatment_id from public.treatment_sessions where id = v_s.session_id))),
            coalesce(v_s.content -> 'sections', '[]'), coalesce(v_s.content -> 'medications', '[]'),
            case when (v_s.content ->> 'follow_up_days') ~ '^[0-9]+$' then (v_s.content ->> 'follow_up_days')::int end)
    returning id into v_id;
  else
    update public.discharge_templates set
      name = coalesce(nullif(btrim(p_name), ''), name), sections = coalesce(v_s.content -> 'sections', '[]'),
      medications = coalesce(v_s.content -> 'medications', '[]'),
      follow_up_days = case when (v_s.content ->> 'follow_up_days') ~ '^[0-9]+$' then (v_s.content ->> 'follow_up_days')::int end,
      version = version + 1
    where id = p_template_id returning id into v_id;
    if v_id is null then
      perform private.fail('not_found', 'template');
    end if;
  end if;
  return (select to_jsonb(t) from public.discharge_templates t where id = v_id);
exception
  when unique_violation then
    perform private.fail('duplicate', 'a template with this name exists');
end;
$$;

------------------------------------------------------------------------------
-- Lists: the 4th billing section shows IP and OP summaries; a bill offers its summary.
------------------------------------------------------------------------------
create or replace function public.discharge_summaries_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_from date;
  v_to date;
  v_status public.doc_status;
  v_patient uuid;
  v_kind text;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_from := coalesce((p_filters ->> 'from')::date, (private.ist(now()))::date - 30);
  v_to := coalesce((p_filters ->> 'to')::date, (private.ist(now()))::date);
  v_status := nullif(p_filters ->> 'status', '')::public.doc_status;
  v_patient := (p_filters ->> 'patient_id')::uuid;
  v_kind := nullif(p_filters ->> 'kind', '');
  if v_patient is null and (v_to < v_from or v_to - v_from > 366) then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  return (
    with filtered as (
      select s.* from public.discharge_summaries s
      where (v_patient is not null and s.patient_id = v_patient
             or v_patient is null and coalesce(s.finalized_at, s.created_at) >= private.ist_at(v_from, '00:00')
                                  and coalesce(s.finalized_at, s.created_at) < private.ist_at(v_to + 1, '00:00'))
        and (v_status is null or s.status = v_status)
        and (v_kind is null or v_kind = 'ip' and s.admission_id is not null or v_kind = 'op' and s.admission_id is null)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'status', f.status, 'created_at', f.created_at, 'finalized_at', f.finalized_at,
                 'patient_id', f.patient_id, 'patient', p.full_name, 'uhid', p.uhid,
                 'kind', case when f.admission_id is not null then 'ip' else 'op' end,
                 'admission_id', a.id, 'ip_number', a.ip_number, 'admitted_at', a.admitted_at,
                 'discharged_at', a.discharged_at,
                 'procedures', case when a.id is not null then to_jsonb(a.procedures)
                                    when op.c ->> 'treatment' is not null then jsonb_build_array(op.c ->> 'treatment') end,
                 'visit_id', f.visit_id, 'session_id', f.session_id, 'visit_date', op.c ->> 'date',
                 'session_seq', op.c -> 'session_seq')
               order by coalesce(f.finalized_at, f.created_at) desc, f.id)
        from (select * from filtered order by coalesce(finalized_at, created_at) desc, id
              limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f
        join public.patients p on p.id = f.patient_id
        left join public.admissions a on a.id = f.admission_id
        left join lateral (select private.op_card(f.visit_id, f.session_id) as c where f.admission_id is null) op on true), '[]'::jsonb)));
end;
$$;

-- The papers with a bill: breakdown bills, the stay's summary (IP), or the visit's summary (OP:
-- `op` says which visit / session a new one would be for).
create or replace function public.bill_paperwork(p_bill_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_b public.bills;
  v_visit uuid;
  v_session uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select * into v_b from public.bills where id = p_bill_id;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_b.admission_id is null and (v_b.visit_id is not null or v_b.session_id is not null) then
    select r.visit_id, r.session_id into v_visit, v_session from private.op_resolve(v_b.visit_id, v_b.session_id) r;
  end if;
  return jsonb_build_object(
    'breakdowns', coalesce((
      select jsonb_agg(jsonb_build_object('id', bb.id, 'bb_no', bb.bb_no, 'status', bb.status, 'total_paise', bb.total_paise)
             order by bb.created_at desc)
      from public.breakdown_bills bb
      where bb.patient_id = v_b.patient_id and bb.status <> 'cancelled'
        and (bb.sources -> 'bill_ids' ? v_b.id::text
             or v_b.admission_id is not null and bb.admission_id = v_b.admission_id
             or v_b.treatment_id is not null and bb.treatment_id = v_b.treatment_id)), '[]'::jsonb),
    'admission', (select jsonb_build_object('id', a.id, 'ip_number', a.ip_number, 'status', a.status,
                                            'summary', (select jsonb_build_object('id', s.id, 'status', s.status)
                                                          from public.discharge_summaries s
                                                         where s.admission_id = a.id and s.status <> 'cancelled' limit 1))
                    from public.admissions a where a.id = v_b.admission_id),
    'op', case when v_visit is not null or v_session is not null then jsonb_build_object(
      'visit_id', v_visit, 'session_id', v_session,
      'summary', (select jsonb_build_object('id', s.id, 'status', s.status) from public.discharge_summaries s
                   where s.status <> 'cancelled' and s.admission_id is null
                     and (s.visit_id = v_visit or v_visit is null and s.visit_id is null and s.session_id = v_session)
                   limit 1)) end);
end;
$$;

select private.lock_down_public_functions();
