-- Every bill says what it is for (owner, 02/11/2026: "can't tell this bill is for session 3 of surgery 1").
-- - bills.session_id: a bill can belong to one treatment session.
-- - create_bill takes appointment_id / visit_id / session_id / treatment_id (each must be this patient's)
--   and fills the visit, session, treatment and doctor from them, the same way create_document does.
-- - add_payment refuses a treatment / IP stay of another patient (a package part payment is an advance
--   with the treatment on it).
-- - bill_card and bills_table carry a "for" object; each treatment session lists its bills and each
--   treatment its money (billed, paid, due); each booking in the patient file lists its visit's bills
--   and prescriptions.

alter table public.bills add column session_id uuid references public.treatment_sessions (id);
create index bills_session on public.bills (session_id) where session_id is not null;

------------------------------------------------------------------------------
-- What a bill is for: treatment (+ session), visit, IP stay, doctor. Keys that don't apply are left out.
------------------------------------------------------------------------------
create function private.bill_for(b public.bills)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'treatment_id', t.id, 'treatment', t.name, 'category', t.category,
    'session_id', s.id, 'session_seq', s.seq,
    'visit_id', v.id, 'visit_date', v.visit_date, 'appointment_id', v.appointment_id,
    'admission_id', ad.id, 'ip_number', ad.ip_number,
    'doctor', coalesce(d.display_name, d.full_name)))
  from (select 1) one
  left join public.treatment_sessions s on s.id = b.session_id
  left join public.patient_treatments t on t.id = coalesce(b.treatment_id, s.treatment_id)
  left join public.visits v on v.id = b.visit_id
  left join public.admissions ad on ad.id = b.admission_id
  left join public.doctors d on d.id = b.doctor_id;
$$;

-- A bill as a small chip (number, type, status, amount to pay, received on it).
create function private.bill_chip(b public.bills)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'bill_no', b.bill_no, 'bill_type', b.bill_type, 'status', b.status,
    'total_paise', b.total_paise + b.carried_in_paise,
    'received_paise', coalesce((select sum(a.amount_paise) from public.payment_allocations a
                                  join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
                                 where a.bill_id = b.id), 0));
$$;

------------------------------------------------------------------------------
-- bill_card: as Phase 7, plus "for".
------------------------------------------------------------------------------
create or replace function private.bill_card(p_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(b) || jsonb_build_object(
    'patient', p.full_name, 'uhid', p.uhid,
    'doctor', coalesce(d.display_name, d.full_name),
    'ip_number', (select ip_number from public.admissions where id = b.admission_id),
    'for', private.bill_for(b),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) || jsonb_build_object('category', c.label, 'category_code', c.code,
                                                          'carried_from_bill_no', sb.bill_no) order by i.line_no)
      from public.bill_items i left join public.lookup_values c on c.id = i.category_id
      left join public.bill_items si on si.id = i.carried_from_item_id
      left join public.bills sb on sb.id = si.bill_id
      where i.bill_id = b.id), '[]'::jsonb),
    'carried_bills', coalesce((
      select jsonb_agg(jsonb_build_object('id', cb.id, 'bill_no', cb.bill_no, 'bill_type', cb.bill_type,
                                          'total_paise', cb.total_paise) order by cb.bill_at)
      from public.bills cb where cb.id = any (private.carried_bill_ids(b.id))), '[]'::jsonb),
    'received_paise', coalesce((
      select sum(a.amount_paise) from public.payment_allocations a
      join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
      where a.bill_id = b.id or a.bill_id = any (private.carried_bill_ids(b.id))), 0))
  from public.bills b
  join public.patients p on p.id = b.patient_id
  left join public.doctors d on d.id = b.doctor_id
  where b.id = p_bill_id;
$$;

------------------------------------------------------------------------------
-- bills_table: as Phase 5, plus "for" on each row.
------------------------------------------------------------------------------
create or replace function public.bills_table(p_filters jsonb default '{}', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_from date := coalesce((p_filters ->> 'from')::date, (private.ist(now()))::date - 30);
  v_to date := coalesce((p_filters ->> 'to')::date, (private.ist(now()))::date);
  v_status public.doc_status := (p_filters ->> 'status')::public.doc_status;
  v_type public.bill_type := (p_filters ->> 'bill_type')::public.bill_type;
  v_patient uuid := (p_filters ->> 'patient_id')::uuid;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  if v_patient is null and (v_to < v_from or v_to - v_from > 366) then
    perform private.fail('invalid_input', 'date range (max one year)');
  end if;
  return (
    with filtered as (
      select b.* from public.bills b
      where (v_patient is not null and b.patient_id = v_patient
             or v_patient is null and coalesce(b.bill_at, b.created_at) >= private.ist_at(v_from, '00:00')
                                  and coalesce(b.bill_at, b.created_at) < private.ist_at(v_to + 1, '00:00'))
        and (v_status is null or b.status = v_status)
        and (v_type is null or b.bill_type = v_type)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'sum_paise', (select coalesce(sum(total_paise), 0) from filtered where status = 'finalized'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'bill_type', f.bill_type, 'bill_no', f.bill_no, 'status', f.status, 'bill_at', f.bill_at,
          'created_at', f.created_at, 'total_paise', f.total_paise + f.carried_in_paise, 'patient_id', f.patient_id,
          'patient', p.full_name, 'uhid', p.uhid, 'for', private.bill_for(bb),
          'received_paise', coalesce((select sum(a.amount_paise) from public.payment_allocations a
                                        join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
                                       where a.bill_id = f.id), 0))
          order by coalesce(f.bill_at, f.created_at) desc, f.id)
        from (select * from filtered order by coalesce(bill_at, created_at) desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f
        join public.bills bb on bb.id = f.id
        join public.patients p on p.id = f.patient_id), '[]'::jsonb)));
end;
$$;

------------------------------------------------------------------------------
-- create_bill: as Phase 7, plus links to a booking / visit / treatment session / treatment.
-- Each must be this patient's; the rest follows (booking → visit + its session; session → treatment
-- + its booking's visit). Doctor: given, else the stay's primary surgeon, the visit's, the session's,
-- the treatment's.
------------------------------------------------------------------------------
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
  return private.bill_card(v_id);
exception
  when invalid_text_representation then
    perform private.fail('invalid_input', 'link');
end;
$$;

------------------------------------------------------------------------------
-- add_payment: as Phase 7, plus: the treatment / IP stay on a payment must be this patient's.
------------------------------------------------------------------------------
create or replace function public.add_payment(p_payment jsonb, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  v_kind public.payment_kind := coalesce((p_payment ->> 'kind')::public.payment_kind, 'payment');
  v_patient uuid := (p_payment ->> 'patient_id')::uuid;
  v_amount bigint := (p_payment ->> 'amount_paise')::bigint;
  v_alloc jsonb;
  v_row public.payments;
begin
  if p_client_id is null then
    perform private.fail('invalid_input', 'client id');
  end if;
  select * into v_row from public.payments where id = p_client_id;
  if found then
    return to_jsonb(v_row);
  end if;
  if v_amount is null or v_amount <= 0 then
    perform private.fail('invalid_input', 'amount');
  end if;
  if p_payment ->> 'treatment_id' is not null and not exists (
       select 1 from public.patient_treatments where id = (p_payment ->> 'treatment_id')::uuid and patient_id = v_patient) then
    perform private.fail('invalid_input', 'treatment_id');
  end if;
  if p_payment ->> 'admission_id' is not null and not exists (
       select 1 from public.admissions where id = (p_payment ->> 'admission_id')::uuid and patient_id = v_patient) then
    perform private.fail('invalid_input', 'admission_id');
  end if;
  if v_kind = 'refund' and v_amount > private.patient_credit(v_patient) then
    perform private.fail('over_allocated', 'a refund can''t be more than the patient''s advance');
  end if;
  insert into public.payments (id, patient_id, kind, mode_id, amount_paise, reference, received_by, treatment_id, admission_id, note)
  values (p_client_id, v_patient, v_kind, (p_payment ->> 'mode_id')::uuid, v_amount,
          nullif(btrim(p_payment ->> 'reference'), ''), v_staff, (p_payment ->> 'treatment_id')::uuid,
          (p_payment ->> 'admission_id')::uuid, nullif(btrim(p_payment ->> 'note'), ''))
  returning * into v_row;
  if v_kind <> 'refund' then
    for v_alloc in select value from jsonb_array_elements(coalesce(p_payment -> 'allocations', '[]'::jsonb)) loop
      if private.allocate_payment(v_row.id, (v_alloc ->> 'bill_id')::uuid, (v_alloc ->> 'amount_paise')::bigint)
         < (v_alloc ->> 'amount_paise')::bigint then
        perform private.fail('over_allocated', 'more than the bill');
      end if;
    end loop;
  end if;
  perform private.library_used('lookup_values', v_row.mode_id);
  return to_jsonb(v_row);
exception
  when foreign_key_violation or invalid_text_representation or not_null_violation then
    perform private.fail('invalid_input', sqlerrm);
end;
$$;

------------------------------------------------------------------------------
-- Money of one treatment. Each amount counted once:
--   billed = finalized bills of the treatment (their own lines; a final bill's carried-in lines are
--            already counted at the bills they came from);
--   paid   = payments allocated to those bills + what is still unused of advances / payments made
--            for the treatment (a package part payment);
--   due    = (agreed price, or the package price, or what was billed — the largest) − paid.
------------------------------------------------------------------------------
create function private.treatment_money(t public.patient_treatments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with billed as (
    select coalesce(sum(b.total_paise), 0) as paise from public.bills b
    where b.treatment_id = t.id and b.status = 'finalized'
  ), allocated as (
    select coalesce(sum(a.amount_paise), 0) as paise from public.payment_allocations a
    join public.payments pay on pay.id = a.payment_id and pay.cancelled_at is null
    join public.bills b on b.id = a.bill_id and b.treatment_id = t.id
  ), unused as (
    select coalesce(sum(pay.amount_paise - coalesce((select sum(a.amount_paise) from public.payment_allocations a
                                                      where a.payment_id = pay.id), 0)), 0) as paise
    from public.payments pay
    where pay.treatment_id = t.id and pay.cancelled_at is null and pay.kind in ('payment', 'advance')
  )
  select jsonb_build_object(
    'billed_paise', billed.paise,
    'paid_paise', allocated.paise + unused.paise,
    'advance_paise', unused.paise,
    'due_paise', greatest(greatest(coalesce(t.agreed_price_paise,
                                            case when t.pricing = 'package' then t.package_price_paise else 0 end),
                                   billed.paise) - allocated.paise - unused.paise, 0))
  from billed, allocated, unused;
$$;

------------------------------------------------------------------------------
-- treatment_card: as 20261114120000, plus each session's bills and the treatment's money.
-- A session's bills: those made for it, and older ones made for its booking's visit.
------------------------------------------------------------------------------
create or replace function private.treatment_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(t) || private.treatment_money(t) || jsonb_build_object(
    'doctor', coalesce(d.display_name, d.full_name),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'seq', s.seq, 'planned_date', s.planned_date, 'actual_date', s.actual_date,
               'status', s.status, 'appointment_id', s.appointment_id, 'slot_start', a.slot_start, 'notes', s.notes,
               'documents', coalesce((
                 select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'file_id', d.file_id) order by d.created_at)
                 from public.documents d where d.session_id = s.id and not d.archived), '[]'::jsonb),
               'bills', coalesce((
                 select jsonb_agg(private.bill_chip(b) order by b.created_at)
                 from public.bills b
                 where b.status <> 'cancelled'
                   and (b.session_id = s.id
                        or b.session_id is null and b.visit_id is not null
                           and b.visit_id = (select v.id from public.visits v where v.appointment_id = s.appointment_id))),
                 '[]'::jsonb))
             order by s.seq)
      from public.treatment_sessions s left join public.appointments a on a.id = s.appointment_id
      where s.treatment_id = t.id), '[]'::jsonb),
    'bills', coalesce((
      select jsonb_agg(private.bill_chip(b) order by b.created_at)
      from public.bills b
      where b.treatment_id = t.id and b.session_id is null and b.status <> 'cancelled'
        and (b.visit_id is null or not exists (select 1 from public.visits v join public.treatment_sessions s2
                                                 on s2.appointment_id = v.appointment_id and s2.treatment_id = t.id
                                               where v.id = b.visit_id))), '[]'::jsonb),
    'done_count', (select count(*) from public.treatment_sessions s where s.treatment_id = t.id and s.status = 'done'))
  from public.patient_treatments t left join public.doctors d on d.id = t.doctor_id
  where t.id = p_id;
$$;

------------------------------------------------------------------------------
-- patient_appointments: as Phase 3, plus each booking's visit, its bills and prescriptions.
------------------------------------------------------------------------------
create or replace function public.patient_appointments(p_patient_id uuid, p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_c jsonb := case when p_cursor is null or p_cursor = '' then null else p_cursor::jsonb end;
  v_rows jsonb;
begin
  perform private.require_staff(array['receptionist', 'admin']::public.staff_role[]);
  select coalesce(jsonb_agg(x.card order by x.at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select private.appt_card(a, p) || jsonb_build_object(
             'doctor', coalesce(d.display_name, d.full_name), 'appt_date', a.appt_date,
             'visit_id', v.id,
             'session', (select jsonb_build_object('id', s.id, 'seq', s.seq, 'treatment', t.name)
                           from public.treatment_sessions s join public.patient_treatments t on t.id = s.treatment_id
                          where s.appointment_id = a.id order by s.seq limit 1),
             'bills', coalesce((select jsonb_agg(private.bill_chip(b) order by b.created_at) from public.bills b
                                 where v.id is not null and b.visit_id = v.id and b.status <> 'cancelled'), '[]'::jsonb),
             'documents', coalesce((select jsonb_agg(jsonb_build_object('id', doc.id, 'title', doc.title, 'file_id', doc.file_id)
                                                     order by doc.created_at)
                                      from public.documents doc where v.id is not null and doc.visit_id = v.id and not doc.archived),
                                   '[]'::jsonb)) as card,
           coalesce(a.slot_start, a.arrived_at) as at, a.id
    from public.appointments a
    join public.patients p on p.id = a.patient_id
    left join public.doctors d on d.id = a.doctor_id
    left join public.visits v on v.appointment_id = a.id
    where a.patient_id = p_patient_id
      and (v_c is null or (coalesce(a.slot_start, a.arrived_at), a.id) < ((v_c ->> 0)::timestamptz, (v_c ->> 1)::uuid))
    order by coalesce(a.slot_start, a.arrived_at) desc, a.id desc
    limit v_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e where e.ordinality <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_array(coalesce(v_rows -> (v_limit - 1) ->> 'slot_start', v_rows -> (v_limit - 1) ->> 'arrived_at'),
                        v_rows -> (v_limit - 1) ->> 'id')::text end);
end;
$$;

select private.lock_down_public_functions();
