-- Patient timeline, precise and short (owner, 02/11/2026: "improve the history to be precise and
-- concise"; payments and advances must show). Each event now carries the facts the screen needs
-- in `ref` (amount, mode, bill number, IP number, doctor, status), so the app writes one translated
-- line per event instead of showing raw codes. IP stays (admitted / discharged) join the timeline.
-- `title` stays as a plain-English fallback.
create or replace function private.patient_events(p_patient_id uuid)
returns table (at timestamptz, id uuid, kind text, title text, ref jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select p.created_at, p.id, 'registered', 'Registered — UHID ' || p.uhid, jsonb_build_object('uhid', p.uhid)
  from public.patients p where p.id = p_patient_id
  union all
  select d.created_at, d.id, 'document', d.title,
         jsonb_build_object('document_id', d.id, 'file_id', d.file_id, 'kind', l.label)
  from public.documents d left join public.lookup_values l on l.id = d.kind_id
  where d.patient_id = p_patient_id and not d.archived
  union all
  select m.merged_at, m.id, 'merged', 'Merged another record into this one',
         jsonb_build_object('from_id', m.from_id, 'moved', m.moved)
  from public.patient_merges m where m.into_id = p_patient_id
  union all
  select coalesce(a.slot_start, a.arrived_at, a.created_at), a.id, 'appointment',
         coalesce(dr.display_name, dr.full_name, 'Walk-in') || ' — ' || a.status::text,
         jsonb_build_object('status', a.status, 'type', a.type, 'doctor_id', a.doctor_id,
                            'doctor', coalesce(dr.display_name, dr.full_name))
  from public.appointments a left join public.doctors dr on dr.id = a.doctor_id
  where a.patient_id = p_patient_id and a.status <> 'rescheduled'
  union all
  select t.created_at, t.id, 'treatment', 'Started ' || t.name, jsonb_build_object('treatment_id', t.id, 'status', t.status)
  from public.patient_treatments t where t.patient_id = p_patient_id
  union all
  select private.ist_at(s.actual_date, '12:00'), s.id, 'session',
         format('%s — session %s done', t.name, s.seq), jsonb_build_object('treatment_id', t.id, 'seq', s.seq)
  from public.treatment_sessions s join public.patient_treatments t on t.id = s.treatment_id
  where s.patient_id = p_patient_id and s.status = 'done' and s.actual_date is not null
  union all
  -- IP stay: admitted, and discharged once that happens (a cancelled admission shows as cancelled).
  select a.admitted_at, a.id, 'admission', 'Admitted — IP ' || a.ip_number,
         jsonb_build_object('admission_id', a.id, 'event', case when a.status = 'cancelled' then 'cancelled' else 'admitted' end,
                            'ip_number', a.ip_number, 'room', r.name)
  from public.admissions a left join public.room_types r on r.id = a.room_type_id
  where a.patient_id = p_patient_id
  union all
  select a.discharged_at, a.id, 'discharge', 'Discharged — IP ' || a.ip_number,
         jsonb_build_object('admission_id', a.id, 'ip_number', a.ip_number,
                            'nights', private.room_days(a.admitted_at, a.discharged_at))
  from public.admissions a
  where a.patient_id = p_patient_id and a.discharged_at is not null and a.status <> 'cancelled'
  union all
  select coalesce(b.bill_at, b.created_at), b.id, 'bill', format('%s %s — %s', b.bill_type, b.bill_no, b.status),
         jsonb_build_object('bill_id', b.id, 'bill_type', b.bill_type, 'bill_no', b.bill_no, 'status', b.status,
                            'total_paise', b.total_paise + b.carried_in_paise,
                            'ip_number', (select ip_number from public.admissions where id = b.admission_id))
  from public.bills b where b.patient_id = p_patient_id and b.status <> 'draft'
  union all
  -- Payment / advance / refund: amount, mode, reference, and the bills it paid.
  select p.received_at, p.id, 'payment', format('%s received', p.kind),
         jsonb_build_object('payment_id', p.id, 'kind', p.kind, 'amount_paise', p.amount_paise, 'mode', mo.label,
                            'reference', p.reference, 'note', p.note, 'cancelled', p.cancelled_at is not null,
                            'bills', coalesce((
                              select jsonb_agg(jsonb_build_object('bill_id', b.id, 'bill_no', b.bill_no, 'amount_paise', al.amount_paise)
                                               order by b.bill_at)
                              from public.payment_allocations al join public.bills b on b.id = al.bill_id
                              where al.payment_id = p.id), '[]'::jsonb))
  from public.payments p left join public.lookup_values mo on mo.id = p.mode_id
  where p.patient_id = p_patient_id;
$$;
